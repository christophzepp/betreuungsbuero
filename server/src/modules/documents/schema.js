// Dokumente-Modul (Plan D1, Nutzerauftrag 2026-07-25): Schema fuer den zentralen Dokumentenspeicher.
// Eigene Datei statt Inline-Block in db.js, damit der Testharnisch (Scratchpad, DB-KOPIE) exakt
// dasselbe Schema anlegt wie der Server - kein Drift zwischen Test und Betrieb.
//
// Seit dem Umbau "Echte Ordner" ist die Platte die lesbare Primaerablage. SQLite bleibt Index
// fuer Rechte, Verknuepfungen, Versionen, Volltext und den Abgleich. Die zusaetzlichen
// storage_*/name_key-Spalten werden per ALTER nachgezogen, damit eine bestehende Installation
// ohne Zwischenmigration starten kann. Alte UUID-Blobs bleiben bis zum protokollierten
// Umhaengelauf lesbar.

const crypto = require('crypto');

function ensure(db) {
  db.exec(`
    -- Ordner: area 'case' (je Fall) oder 'office' (Bueroorganisation); parent_id '' = Wurzel.
    CREATE TABLE IF NOT EXISTS doc_folders (
      id TEXT PRIMARY KEY,
      area TEXT NOT NULL DEFAULT 'case',
      case_id TEXT NOT NULL DEFAULT '',
      parent_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_doc_folders_scope ON doc_folders(area, case_id, parent_id);

    -- Dateien: deleted_at leer = aktiv, sonst Papierkorb (30 Tage, dann endgueltig).
    -- ocr_status: none (keine Extraktion noetig/erledigt ueber Textebene) | pending | done | failed.
    CREATE TABLE IF NOT EXISTS doc_files (
      id TEXT PRIMARY KEY,
      area TEXT NOT NULL DEFAULT 'case',
      case_id TEXT NOT NULL DEFAULT '',
      folder_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      pages INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      ocr_status TEXT NOT NULL DEFAULT 'none',
      deleted_at TEXT NOT NULL DEFAULT '',
      deleted_from TEXT NOT NULL DEFAULT '',
      deleted_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_doc_files_scope ON doc_files(area, case_id, folder_id, deleted_at);

    -- Anmerkungen als eigene Datensaetze NEBEN der Datei (nie ins Original gebrannt).
    -- geo_json: {x,y,farbe,pfad?...} in Prozent der Seitenflaeche (auflösungsunabhaengig).
    CREATE TABLE IF NOT EXISTS doc_annotations (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      page INTEGER NOT NULL DEFAULT 1,
      art TEXT NOT NULL DEFAULT 'Kommentar',
      text TEXT NOT NULL DEFAULT '',
      geo_json TEXT NOT NULL DEFAULT '{}',
      author TEXT NOT NULL DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_doc_annotations_file ON doc_annotations(file_id, page);

    -- Zeitplaene fuer Backup/Synchronisierung (D8; Tabelle jetzt schon, UI/Scheduler folgen):
    -- interval taeglich|woechentlich|monatlich, weekdays '1,3,5' (Mo=1), time_hhmm '21:30',
    -- source_json/target_json beschreiben Ordner bzw. Anbieter/Ziel.
    CREATE TABLE IF NOT EXISTS doc_backup_jobs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      interval TEXT NOT NULL DEFAULT 'taeglich',
      weekdays TEXT NOT NULL DEFAULT '',
      time_hhmm TEXT NOT NULL DEFAULT '02:00',
      source_json TEXT NOT NULL DEFAULT '{}',
      target_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT NOT NULL DEFAULT '',
      last_result TEXT NOT NULL DEFAULT '',
      retry_context_json TEXT NOT NULL DEFAULT '{}',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Dauerhafter Zustand des Sicherungsplaners. Die Zeile überlebt einen
    -- Serverneustart und macht deshalb auch einen abgebrochenen/hängenden Lauf
    -- sowie einen verpassten Takt im Admin-Status sichtbar.
    CREATE TABLE IF NOT EXISTS doc_backup_scheduler_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      started_at TEXT NOT NULL DEFAULT '',
      heartbeat_at TEXT NOT NULL DEFAULT '',
      last_tick_at TEXT NOT NULL DEFAULT '',
      last_tick_error TEXT NOT NULL DEFAULT '',
      last_tick_error_at TEXT NOT NULL DEFAULT '',
      health_status TEXT NOT NULL DEFAULT 'not_configured',
      health_key TEXT NOT NULL DEFAULT '',
      last_health_change_at TEXT NOT NULL DEFAULT '',
      last_warning_at TEXT NOT NULL DEFAULT '',
      last_mail_at TEXT NOT NULL DEFAULT '',
      last_mail_error TEXT NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO doc_backup_scheduler_state (id) VALUES (1);

    -- Import-Eingang (D29): Gegenrichtung der Sicherung - ein Quellordner auf einer
    -- Verbindung wird minuetlich gelesen, Neues/Geaendertes landet als Kopie im
    -- Dokumentenspeicher. Additiv, am Anbieter wird nie geschrieben oder geloescht.
    CREATE TABLE IF NOT EXISTS doc_import_jobs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      mount_id TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      target_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT NOT NULL DEFAULT '',
      last_result TEXT NOT NULL DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Aenderungsgedaechtnis je Import-Eingang: Quellpfad -> Groesse|Aenderungstag + sha256.
    -- Gleiche Pruefsumme unter neuem Pfad = verschoben/umbenannt, wird nicht erneut abgelegt.
    CREATE TABLE IF NOT EXISTS doc_import_state (
      job_id TEXT NOT NULL,
      pfad TEXT NOT NULL,
      merkmal TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      file_id TEXT DEFAULT NULL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (job_id, pfad)
    );
    CREATE INDEX IF NOT EXISTS idx_doc_import_state_sha ON doc_import_state(job_id, sha256);

    -- Zwei-Wege-Fallordner-Paarung (D30): ein Anbieter-Ordner und ein Speicher-Ordner werden
    -- in BEIDE Richtungen abgeglichen. doc_pair_state ist das Herkunfts-Gedaechtnis je Datei:
    -- sha256 des letzten Abgleichs ist die gemeinsame Wahrheit - so weiss jede Richtung, ob
    -- die Gegenseite oder sie selbst sich geaendert hat (kein Ping-Pong).
    CREATE TABLE IF NOT EXISTS doc_pair_jobs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      mount_id TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      target_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT NOT NULL DEFAULT '',
      last_result TEXT NOT NULL DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS doc_pair_state (
      pair_id TEXT NOT NULL,
      pfad TEXT NOT NULL,
      remote_merkmal TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      file_id TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (pair_id, pfad)
    );

    -- Persoenliche Explorer-Einstellungen JE NUTZER (Nutzerwunsch: Klapp-Zustand des Baums,
    -- Ansicht, Sortierung merkt sich der SERVER, nicht der Browser).
    CREATE TABLE IF NOT EXISTS doc_user_prefs (
      user_id INTEGER PRIMARY KEY,
      data_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- WebDAV-Freigabe (D7): App-Passwoerter JE NUTZER fuer das Netzlaufwerk - nie das
    -- Anmelde-Passwort. Nur der bcrypt-Hash liegt hier; das Passwort wird EINMALIG angezeigt.
    CREATE TABLE IF NOT EXISTS doc_webdav_tokens (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      pass_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_doc_webdav_tokens_user ON doc_webdav_tokens(user_id);

    -- Externe Ablagen (D6; Tabelle jetzt schon): kind nextcloud|webdav|onedrive|gdrive|localdir,
    -- config_json verschluesselte/strukturierte Verbindungsdaten (Verschluesselung wie Mail-Konten).
    CREATE TABLE IF NOT EXISTS doc_mounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'webdav',
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Sicherungsplan-Härtung: getrennte Felder für den geplanten Termin, den
  // tatsächlichen Versuch und den letzten Erfolg. Dadurch kann ein Fehlschlag
  // weder den Nachhollauf noch die inkrementelle Sicherungsgrenze fälschlich
  // als erfolgreich erledigt markieren. Alle Spalten sind additive Migrationen
  // und lassen bestehende Zeitpläne unverändert weiterlaufen.
  for (const sql of [
    "ALTER TABLE doc_backup_jobs ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE doc_backup_jobs ADD COLUMN config_changed_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN run_started_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN last_scheduled_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN next_retry_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE doc_backup_jobs ADD COLUMN last_success_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN mount_cursor_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN last_failure_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN last_warning_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN last_warning_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN last_mail_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN last_mail_error TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_backup_jobs ADD COLUMN retry_context_json TEXT NOT NULL DEFAULT '{}'"
  ]) {
    try { db.exec(sql); } catch (_e) { /* existiert */ }
  }
  // Vor der Erweiterung bedeutete last_run_at sowohl Versuch als auch Erfolg.
  // Nur eindeutig erfolgreiche Altzeilen dürfen als Erfolg übernommen werden.
  // mount_cursor_at wird für bestehende Mount-Pläne bewusst NICHT aus dem
  // früheren Laufende abgeleitet: Bei einem langen Alt-Lauf könnten sonst
  // während des Uploads entstandene Dateien dauerhaft hinter dem Cursor
  // liegen. Der erste Lauf nach der Migration ist daher einmalig ein sicherer,
  // idempotenter Volllauf.
  db.exec(`
    UPDATE doc_backup_jobs
       SET last_success_at = last_run_at
     WHERE last_success_at = '' AND last_run_at != '' AND last_result LIKE 'ok:%';
    UPDATE doc_backup_jobs
       SET last_failure_at = last_run_at
     WHERE last_failure_at = '' AND last_run_at != ''
       AND (last_result LIKE 'Fehler:%' OR last_result LIKE 'Zeitüberschreitung:%');
    UPDATE doc_backup_jobs
       SET last_scheduled_at = last_run_at
     WHERE last_scheduled_at = '' AND last_run_at != '';
  `);

  // Volltext je SEITE (Fundstellen springen die Seite in der Leseansicht an). FTS5 ist in
  // better-sqlite3 standardmaessig einkompiliert; falls eine fremde SQLite-Umgebung es nicht
  // mitbringt, faellt die Suche auf eine LIKE-Tabelle zurueck (gleiche Spalten, langsamer).
  let fts = true;
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS doc_text USING fts5(
      file_id UNINDEXED, page UNINDEXED, text, tokenize='unicode61 remove_diacritics 2'
    );`);
  } catch (_e) {
    fts = false;
    db.exec(`CREATE TABLE IF NOT EXISTS doc_text (
      file_id TEXT NOT NULL, page INTEGER NOT NULL DEFAULT 1, text TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_doc_text_file ON doc_text(file_id);`);
  }
  // D11: Notizfeld je Datei + Versionsverlauf (alte Fassung bei Ueberschreiben behalten).
  try { db.exec("ALTER TABLE doc_files ADD COLUMN note TEXT NOT NULL DEFAULT ''"); } catch (_e) { /* existiert */ }
  // D13: Wiedervorlage je Datei. Der kanonische Wiedervorlagen-Eintrag liegt in todos; die
  // Dateispalten bleiben als schneller Marker fuer Chips und Explorer-Filter synchron erhalten.
  try { db.exec("ALTER TABLE doc_files ADD COLUMN resubmit_at TEXT NOT NULL DEFAULT ''"); } catch (_e) { /* existiert */ }
  try { db.exec("ALTER TABLE doc_files ADD COLUMN resubmit_note TEXT NOT NULL DEFAULT ''"); } catch (_e) { /* existiert */ }
  const linkedFollowup = db.prepare(`
    SELECT * FROM todos
     WHERE item_type = 'followup' AND source_type = 'document' AND source_id = ?
     ORDER BY done, created_at LIMIT 1
  `);
  const legacyFollowup = db.prepare(`
    SELECT * FROM todos
     WHERE item_type = 'followup' AND source_type = '' AND done = 0
       AND title = @title AND due_at = @dueAt
       AND ((@caseId != '' AND (
              case_id = @caseId
              OR (case_id = '' AND case_label = @caseLabel
                  AND (SELECT COUNT(*) FROM cases WHERE label = @caseLabel) = 1)
            ))
         OR (@caseId = '' AND case_id = '' AND case_label = ''))
     ORDER BY created_at LIMIT 1
  `);
  const adoptFollowup = db.prepare(`
    UPDATE todos
       SET case_id=@caseId, case_label=@caseLabel, source_type='document', source_id=@sourceId,
           source_module='documents', source_ref=@sourceRef, updated_at=datetime('now')
     WHERE id=@id
  `);
  const insertFollowup = db.prepare(`
    INSERT INTO todos
      (id, title, description, due_at, start_at, done, priority, recurrence_rule, case_label,
       item_type, case_id, source_type, source_id, source_module, source_ref, source, updated_by)
    VALUES
      (@id, @title, @description, @dueAt, '', 0, 'normal', '', @caseLabel,
       'followup', @caseId, 'document', @sourceId, 'documents', @sourceRef, 'local', @userId)
  `);
  const clearDocumentFollowup = db.prepare("UPDATE doc_files SET resubmit_at='', resubmit_note='' WHERE id=?");
  const caseLabelForId = db.prepare('SELECT label FROM cases WHERE id = ?');
  const migrateDocumentFollowups = db.transaction(() => {
    const files = db.prepare("SELECT id, name, area, case_id, resubmit_at, resubmit_note, created_by FROM doc_files WHERE resubmit_at != ''").all();
    for (const file of files) {
      const linked = linkedFollowup.get(file.id);
      if (linked) {
        if (linked.done) clearDocumentFollowup.run(file.id);
        continue;
      }
      const caseId = file.area === 'case' ? String(file.case_id || '') : '';
      const caseRow = caseId ? caseLabelForId.get(caseId) : null;
      const values = {
        title: `Wiedervorlage: ${String(file.name || 'Dokument')}`,
        dueAt: String(file.resubmit_at || ''),
        caseId,
        caseLabel: caseRow ? String(caseRow.label || '') : '',
        sourceId: String(file.id),
        sourceRef: `document:${file.id}`
      };
      const legacy = legacyFollowup.get(values);
      if (legacy) {
        adoptFollowup.run({ ...values, id: legacy.id });
      } else {
        insertFollowup.run({
          ...values,
          id: crypto.randomUUID(),
          description: String(file.resubmit_note || ''),
          userId: file.created_by == null ? null : file.created_by
        });
      }
    }
  });
  migrateDocumentFollowups();
  db.exec(`CREATE TABLE IF NOT EXISTS doc_versions (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    ersetzt_von TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_doc_versions_file ON doc_versions(file_id);`);
  try { db.exec("ALTER TABLE doc_versions ADD COLUMN storage_relpath TEXT NOT NULL DEFAULT ''"); } catch (_e) { /* existiert */ }
  // D10: Markierungen je Datei (CSV der Tag-IDs) - Spalte nachziehen, falls Bestand.
  try { db.exec("ALTER TABLE doc_files ADD COLUMN tags TEXT NOT NULL DEFAULT ''"); } catch (_e) { /* existiert */ }
  // Echte-Ordner-Pfadschicht: storage_relpath ist immer relativ zur konfigurierten
  // Dokumentenspeicher-Wurzel und enthaelt nie "..". name_key ist der NFC-/case-insensitive
  // Kollisionsschluessel, storage_dev/storage_ino ermoeglichen das Erkennen von Finder-Moves.
  for (const sql of [
    "ALTER TABLE doc_folders ADD COLUMN name_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_folders ADD COLUMN storage_relpath TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_folders ADD COLUMN storage_dev TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_folders ADD COLUMN storage_ino TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_folders ADD COLUMN storage_status TEXT NOT NULL DEFAULT 'legacy'",
    "ALTER TABLE doc_folders ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_folders ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_files ADD COLUMN name_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_files ADD COLUMN storage_relpath TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_files ADD COLUMN storage_dev TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_files ADD COLUMN storage_ino TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_files ADD COLUMN storage_status TEXT NOT NULL DEFAULT 'legacy'",
    "ALTER TABLE doc_files ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_files ADD COLUMN visibility TEXT NOT NULL DEFAULT 'standard'",
    "ALTER TABLE doc_files ADD COLUMN artifact_kind TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE doc_files ADD COLUMN managed INTEGER NOT NULL DEFAULT 0"
  ]) {
    try { db.exec(sql); } catch (_e) { /* existiert */ }
  }
  // Bestandszeilen erhalten sofort einen stabilen Vergleichsschluessel. Die volle
  // Dateinamensbereinigung (ungueltige Zeichen/Bytegrenze) geschieht bewusst erst im
  // protokollierten Umhaengelauf und niemals still beim Serverstart.
  const keyOf = (value) => String(value || '').normalize('NFC').toLocaleLowerCase('de-DE');
  const folderKeyRows = db.prepare("SELECT id, name FROM doc_folders WHERE name_key = ''").all();
  const fileKeyRows = db.prepare("SELECT id, name FROM doc_files WHERE name_key = ''").all();
  const setFolderKey = db.prepare('UPDATE doc_folders SET name_key = ? WHERE id = ?');
  const setFileKey = db.prepare('UPDATE doc_files SET name_key = ? WHERE id = ?');
  const fillNameKeys = db.transaction(() => {
    for (const row of folderKeyRows) setFolderKey.run(keyOf(row.name), row.id);
    for (const row of fileKeyRows) setFileKey.run(keyOf(row.name), row.id);
  });
  fillNameKeys();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_doc_folders_name_key
      ON doc_folders(area, case_id, parent_id, name_key);
    CREATE INDEX IF NOT EXISTS idx_doc_folders_storage_relpath
      ON doc_folders(storage_relpath);
    CREATE INDEX IF NOT EXISTS idx_doc_folders_storage_inode
      ON doc_folders(storage_dev, storage_ino);
    CREATE INDEX IF NOT EXISTS idx_doc_files_name_key
      ON doc_files(area, case_id, folder_id, deleted_at, name_key);
    CREATE INDEX IF NOT EXISTS idx_doc_files_storage_relpath
      ON doc_files(storage_relpath);
    CREATE INDEX IF NOT EXISTS idx_doc_files_storage_inode
      ON doc_files(storage_dev, storage_ino);

    -- Ein physisches Dokument kann mehreren Modulen/Fachobjekten zugeordnet sein. Dadurch
    -- bleiben z.B. Finanzbeleg und Buchung bzw. Doku-Foto und mehrere Doku-Eintraege verbunden,
    -- ohne dass eine zweite Dateikopie entsteht.
    CREATE TABLE IF NOT EXISTS doc_links (
      module TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      slot TEXT NOT NULL DEFAULT '',
      file_id TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (module, owner_id, slot),
      FOREIGN KEY (file_id) REFERENCES doc_files(id)
    );
    CREATE INDEX IF NOT EXISTS idx_doc_links_file ON doc_links(file_id);

    -- Physischer Fallordner. Die Buchstabenebene bleibt hier absichtlich erhalten; nur die
    -- Explorer-Darstellung blendet sie aus. birth_key dokumentiert die Namensgleichheitsregel.
    CREATE TABLE IF NOT EXISTS doc_case_roots (
      case_id TEXT PRIMARY KEY,
      area TEXT NOT NULL DEFAULT 'Fallakten',
      letter TEXT NOT NULL DEFAULT '',
      folder_name TEXT NOT NULL DEFAULT '',
      folder_key TEXT NOT NULL DEFAULT '',
      birth_key TEXT NOT NULL DEFAULT '',
      storage_relpath TEXT NOT NULL DEFAULT '',
      root_source TEXT NOT NULL DEFAULT 'generated',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES cases(id)
    );
    CREATE INDEX IF NOT EXISTS idx_doc_case_roots_name
      ON doc_case_roots(area, letter, folder_key);

    -- Jeder Leseabgleich ist als Lauf nachvollziehbar. findings_json enthaelt ausschliesslich
    -- Befunde; ein Scan loescht und verschiebt nichts.
    CREATE TABLE IF NOT EXISTS doc_integrity_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'read',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      summary_json TEXT NOT NULL DEFAULT '{}',
      report_path TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS doc_integrity_findings (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      file_id TEXT NOT NULL DEFAULT '',
      storage_relpath TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (run_id, seq),
      FOREIGN KEY (run_id) REFERENCES doc_integrity_runs(id)
    );

    -- Journal fuer den abbrechbaren, wiederholbaren Bestandsumbau. Derselbe source_key wird
    -- genau einmal abgeschlossen; ein abgebrochener Lauf kann an der naechsten Zeile fortfahren.
    CREATE TABLE IF NOT EXISTS doc_migration_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      dry_run INTEGER NOT NULL DEFAULT 1,
      summary_json TEXT NOT NULL DEFAULT '{}',
      report_path TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS doc_migration_items (
      source_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      target_path TEXT NOT NULL DEFAULT '',
      file_id TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      adjustments_json TEXT NOT NULL DEFAULT '[]',
      error_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES doc_migration_runs(id)
    );

    -- Automatisch gepflegte, aus Fachdaten ableitbare Dateien. Pro Fall/Büro und
    -- Artefaktart existiert genau eine aktuelle Fassung im Dokumentenspeicher.
    CREATE TABLE IF NOT EXISTS doc_materializations (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL DEFAULT '',
      artifact_kind TEXT NOT NULL,
      file_id TEXT NOT NULL DEFAULT '',
      source_revision TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT NOT NULL DEFAULT '',
      generated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (scope_type, scope_id, artifact_kind),
      FOREIGN KEY (file_id) REFERENCES doc_files(id)
    );
    CREATE INDEX IF NOT EXISTS idx_doc_materializations_file
      ON doc_materializations(file_id);

    -- Konfigurierbarer Plattenabgleich. Die zwei Standardpläne werden unten
    -- idempotent angelegt; automatische Finder-Löschungen bleiben aus.
    CREATE TABLE IF NOT EXISTS doc_maintenance_plans (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      schedule_type TEXT NOT NULL DEFAULT 'daily',
      weekdays TEXT NOT NULL DEFAULT '',
      time_hhmm TEXT NOT NULL DEFAULT '02:30',
      verification TEXT NOT NULL DEFAULT 'quick',
      apply_mode TEXT NOT NULL DEFAULT 'confirm',
      auto_delete INTEGER NOT NULL DEFAULT 0,
      last_started_at TEXT NOT NULL DEFAULT '',
      last_finished_at TEXT NOT NULL DEFAULT '',
      last_status TEXT NOT NULL DEFAULT '',
      last_result_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Nur der OCR-Volltext des Fallbeginns wird aus dem häufig geladenen
    -- office_json-Block ausgelagert. payload_json enthält die bisherige OCR-
    -- Dokumentliste verlustfrei, die normalen Antworten nur Metadaten.
    CREATE TABLE IF NOT EXISTS case_intake_ocr (
      draft_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL DEFAULT '[]',
      text_length INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Frühe Entwicklungsstände dieser Erweiterung hatten file_id als NOT NULL
  // mit Leerstring-Vorgabe angelegt. Bei aktivierten Fremdschlüsseln konnte
  // dadurch gerade ein Fehlerstatus ohne erzeugte Datei nicht protokolliert
  // werden. Die Nachziehung erhält bestehende Statuszeilen und macht nur
  // diesen Fremdschlüsselwert korrekt optional.
  const materialFileId = db.prepare('PRAGMA table_info(doc_materializations)').all()
    .find((column) => column.name === 'file_id');
  if (materialFileId && materialFileId.notnull) {
    const foreignKeys = Number(db.pragma('foreign_keys', { simple: true })) !== 0;
    if (foreignKeys) db.pragma('foreign_keys=OFF');
    try {
      db.exec(`
        BEGIN;
        ALTER TABLE doc_materializations RENAME TO doc_materializations_old;
        CREATE TABLE doc_materializations (
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL DEFAULT '',
          artifact_kind TEXT NOT NULL,
          file_id TEXT DEFAULT NULL,
          source_revision TEXT NOT NULL DEFAULT '',
          sha256 TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          last_error TEXT NOT NULL DEFAULT '',
          generated_at TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (scope_type, scope_id, artifact_kind),
          FOREIGN KEY (file_id) REFERENCES doc_files(id)
        );
        INSERT INTO doc_materializations
          (scope_type,scope_id,artifact_kind,file_id,source_revision,sha256,status,last_error,generated_at)
        SELECT scope_type,scope_id,artifact_kind,NULLIF(file_id,''),source_revision,sha256,status,last_error,generated_at
          FROM doc_materializations_old;
        DROP TABLE doc_materializations_old;
        CREATE INDEX idx_doc_materializations_file ON doc_materializations(file_id);
        COMMIT;
      `);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_ignore) { /* bereits zurückgerollt */ }
      throw error;
    } finally {
      if (foreignKeys) db.pragma('foreign_keys=ON');
    }
  }
  db.prepare(`
    INSERT OR IGNORE INTO doc_maintenance_plans
      (id,label,enabled,schedule_type,weekdays,time_hhmm,verification,apply_mode,auto_delete)
    VALUES
      ('default-quick','Tägliche Schnellprüfung',1,'daily','','02:30','quick','confirm',0)
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO doc_maintenance_plans
      (id,label,enabled,schedule_type,weekdays,time_hhmm,verification,apply_mode,auto_delete)
    VALUES
      ('default-full','Wöchentliche Vollprüfung',1,'weekly','0','03:30','full','confirm',0)
  `).run();
  // Eine per Finder-Abgleich bestätigte Fallwurzel ist Benutzerablage und bleibt
  // gegenüber dem aus Stammdaten berechneten Standardpfad maßgeblich. Alte
  // Installationen starten als "generated"; erst ein tatsächlicher Finder-Move
  // setzt die Herkunft ausdrücklich auf "finder".
  try {
    db.exec("ALTER TABLE doc_case_roots ADD COLUMN root_source TEXT NOT NULL DEFAULT 'generated'");
  } catch (_e) { /* existiert */ }
  // D10: Aktivitaetenprotokoll (Nachweis im Mehrbenutzerbetrieb).
  db.exec(`CREATE TABLE IF NOT EXISTS doc_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER, username TEXT NOT NULL DEFAULT '',
    aktion TEXT NOT NULL DEFAULT '', ziel TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '', case_id TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_doc_activity_ts ON doc_activity(ts);`);
  // D17: Modulordner-Import - merkt sich JEDE uebernommene Quelle dauerhaft. Auch wenn die
  // Kopie spaeter geloescht/verschoben wird, gibt es KEINEN Re-Import (Nutzerwille zaehlt).
  db.exec(`CREATE TABLE IF NOT EXISTS doc_module_import (
    quelle TEXT NOT NULL,
    quell_id TEXT NOT NULL,
    file_id TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (quelle, quell_id)
  );`);
  return { fts };
}

module.exports = { ensure };
