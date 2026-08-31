#!/usr/bin/env bash
#
# Vollstaendig isolierter End-to-End-Pruefstand fuer gesamt-backup.sh und
# notfall-rettung.sh. Es werden weder Projekt-DB noch Produktivprozesse geoeffnet.

set -euo pipefail
IFS=$'\n\t'
umask 077

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
TOOLS_DIR=$(CDPATH= cd -- "$TEST_DIR/.." && pwd -P)
BACKUP=$TOOLS_DIR/gesamt-backup.sh
RETTUNG=$TOOLS_DIR/notfall-rettung.sh
RUNNER=$TOOLS_DIR/../src/modules/backup/runner.js

TMP=$(mktemp -d "${TMPDIR:-/tmp}/backup-rettung-test.XXXXXXXX")
SQLITE_PID=
LOCK_BACKUP_PID=
LOCK_WRAPPER_PID=
LOCK_CHILD_PID=
STAGE_BACKUP_PID=
STAGE_SQLITE_PID=

aufräumen() {
  rc=$?
  exec 9>&- 2>/dev/null || true
  if [[ -n ${SQLITE_PID:-} ]]; then
    kill "$SQLITE_PID" 2>/dev/null || true
    wait "$SQLITE_PID" 2>/dev/null || true
  fi
  for pid in "${LOCK_BACKUP_PID:-}" "${LOCK_WRAPPER_PID:-}" "${LOCK_CHILD_PID:-}" \
    "${STAGE_BACKUP_PID:-}" "${STAGE_SQLITE_PID:-}"; do
    [[ $pid =~ ^[1-9][0-9]*$ ]] && kill -9 "$pid" 2>/dev/null || true
  done
  if [[ ${KEEP_BACKUP_TEST_TMP:-0} == 1 && -n ${TMP:-} && -d $TMP ]]; then
    printf 'TEST_TMP_BEHALTEN=%s\n' "$TMP" >&2
  else
    [[ -n ${TMP:-} && -d $TMP ]] && rm -rf -- "$TMP"
  fi
  exit "$rc"
}
trap aufräumen EXIT HUP INT TERM

scheitern() {
  printf 'FEHLER: %s\n' "$*" >&2
  if [[ -n ${TMP:-} && -d $TMP ]]; then
    while IFS= read -r bericht; do
      printf '\n--- %s ---\n' "$bericht" >&2
      sed -n '1,220p' "$bericht" >&2
    done < <(find "$TMP" -type f -name PRUEFBERICHT.txt -print 2>/dev/null)
    printf '\n--- Externe Snapshot-Dateien (Auszug) ---\n' >&2
    find "$TMP" -path '*/inhalt/externe-dokumentwurzeln/*' -type f -print 2>/dev/null |
      sed -n '1,80p' >&2
  fi
  exit 1
}

erwarte_datei() {
  [[ -f $1 ]] || scheitern "Datei fehlt: $1"
}

erwarte_inhalt() {
  local datei=$1 inhalt=$2
  erwarte_datei "$datei"
  [[ $(<"$datei") == "$inhalt" ]] ||
    scheitern "Unerwarteter Inhalt: $datei"
}

finde_eine_datei() {
  local wurzel=$1 name=$2 treffer
  treffer=$(find "$wurzel" -type f -name "$name" -print)
  [[ -n $treffer ]] || scheitern "'$name' wurde unter $wurzel nicht gefunden."
  printf '%s\n' "$treffer" | sed -n '1p'
}

sha() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$1" | awk '{print $1}'
  else
    sha256sum -- "$1" | awk '{print $1}'
  fi
}

groesse() {
  wc -c < "$1" | tr -d ' '
}

sql_text() {
  printf '%s' "$1" | sed "s/'/''/g"
}

bash -n "$BACKUP"
bash -n "$RETTUNG"

SERVER=$TMP/server-fixture
DATA=$SERVER/data
DB=$SERVER/betreuungsbuero.sqlite3
EXTERN=$TMP/externe\ Dokumente
FALLWURZEL=$EXTERN/Fallakten/A/Ärger,\ Anna
STORAGE_ROOT=$TMP/zentrale\ Dokumente
CENTRAL_ROOT=$STORAGE_ROOT
CENTRAL_CASE=$CENTRAL_ROOT/Fallakten/A/Ärger,\ Anna
CENTRAL_OFFICE=$CENTRAL_ROOT/Büroorganisation
CENTRAL_MANAGEMENT=$CENTRAL_OFFICE/_Verwaltung\ \&\ Sicherungen
BACKUP_ZIEL=$TMP/snapshots
BACKUP_ZIEL_2=$TMP/snapshots-fehler
BACKUP_ZIEL_STRICT=$TMP/snapshots-strikt
BACKUP_ZIEL_OFFSITE=$TMP/snapshots-offsite
BACKUP_ZIEL_SQL_FEHLER=$TMP/snapshots-sql-fehler
BACKUP_ZIEL_LOCK=$TMP/snapshots-lock
BACKUP_ZIEL_STAGE=$TMP/snapshots-stage
BACKUP_ZIEL_ENVELOPE=$TMP/snapshots-envelope
RETTUNG_ZIEL=$TMP/lesbare-rettung

mkdir -p \
  "$SERVER/.runtime-secrets" \
  "$SERVER/src/database" \
  "$SERVER/src/config" \
  "$SERVER/src/modules/fixture" \
  "$SERVER/src/security" \
  "$SERVER/src/modules/recovery" \
  "$SERVER/tools/scheduler" \
  "$SERVER/docs" \
  "$SERVER/assets/ocr/core" \
  "$SERVER/assets/ocr/lang" \
  "$SERVER/assets/templates" \
  "$SERVER/node_modules" \
  "$SERVER/_backups" \
  "$SERVER/extension-artifacts" \
  "$TMP/outputs" \
  "$DATA/files" \
  "$DATA/case-documents/case-1" \
  "$DATA/case-doku-photos/case-1/entry-1" \
  "$DATA/inbox-documents" \
  "$DATA/finance-receipts" \
  "$DATA/finance-statements" \
  "$DATA/todo-attachments/todo-1" \
  "$DATA/calendar-event-attachments/event-1" \
  "$DATA/office-logo" \
  "$DATA/custom-hidden" \
  "$CENTRAL_CASE/00 - Eingang" \
  "$CENTRAL_MANAGEMENT" \
  "$FALLWURZEL"

SECURE_JSON_QUELLE=$TOOLS_DIR/../src/security/secure-json.js
RECOVERY_STORE_QUELLE=$TOOLS_DIR/../src/modules/recovery/key-store.js
cp -p -- "$SECURE_JSON_QUELLE" "$SERVER/src/security/secure-json.js"
cp -p -- "$RECOVERY_STORE_QUELLE" "$SERVER/src/modules/recovery/key-store.js"
cp -p -- "$TOOLS_DIR/../src/config/paths.js" "$SERVER/src/config/paths.js"
RUNTIME_SECRET_SENTINEL='drk1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
RECOVERY_KEY_ID=$( \
  DOCUMENTS_DATA_ROOT="$DATA" \
  DOCUMENT_RECOVERY_KEY_FILE="$SERVER/.runtime-secrets/document-recovery-key" \
  RECOVERY_STORE="$SERVER/src/modules/recovery/key-store.js" \
  RECOVERY_KEY="$RUNTIME_SECRET_SENTINEL" \
  node -e '
    const store = require(process.env.RECOVERY_STORE).shared();
    process.stdout.write(store.setKey(process.env.RECOVERY_KEY).keyId);
  ')
RECOVERY_GENERATION_ID=$(node -e 'process.stdout.write(require("crypto").randomUUID())')
RECOVERY_SOURCE_REVISION=
FIXTURE_ENCRYPTION_KEY=$(printf 'a7%.0s' {1..32})
export ENCRYPTION_KEY=$FIXTURE_ENCRYPTION_KEY
printf '{"firefox":{"storedName":"firefox__test.xpi"}}\n' > "$SERVER/extension-artifacts/manifest.json"
printf 'SIGNIERTES-XPI\n' > "$SERVER/extension-artifacts/firefox__test.xpi"
printf 'VORLAGE\n' > "$SERVER/assets/templates/Stammdaten_blank.xlsx"
APP_FIXTURE=$TMP/outputs/Betreuungsbuero_Dokumentenassistent_v999_99.html
printf '<html>TEST-APP</html>\n' > "$APP_FIXTURE"
printf '{"name":"fixture-server","version":"9.9.9"}\n' > "$SERVER/package.json"
printf '{"name":"fixture-server","version":"9.9.9","lockfileVersion":3,"packages":{}}\n' \
  > "$SERVER/package-lock.json"
printf 'FROM node:20-bookworm-slim\nRUN apt-get update && apt-get install -y sqlite3\n' \
  > "$SERVER/Dockerfile"
printf 'services:\n  app:\n    image: fixture-server:9.9.9\n' > "$SERVER/docker-compose.yml"
printf 'data/\nnode_modules/\n.env\n.runtime-secrets/\n' > "$SERVER/.dockerignore"
printf 'NODE_ENV=production\nDOCUMENTS_DATA_ROOT=/app/data\n' > "$SERVER/.env.example"
printf 'module.exports = "INDEX-FIXTURE";\n' > "$SERVER/index.js"
printf 'module.exports = "DB-FIXTURE";\n' > "$SERVER/src/database/index.js"
printf 'module.exports = "ROUTE-FIXTURE";\n' > "$SERVER/src/modules/fixture/routes.js"
printf '#!/usr/bin/env bash\nprintf "TOOL-FIXTURE\\n"\n' > "$SERVER/tools/fixture.sh"
printf 'module.exports = "TOOL-JS-FIXTURE";\n' > "$SERVER/tools/fixture.js"
printf 'SCHEDULER-FIXTURE\n' > "$SERVER/tools/scheduler/fixture.example"
printf 'DOKUMENTATION-FIXTURE\n' > "$SERVER/docs/FIXTURE.txt"
printf 'module.exports = "OCR-FIXTURE";\n' > "$SERVER/assets/ocr/worker.min.js"
printf 'module.exports = "OCR-CORE-FIXTURE";\n' > "$SERVER/assets/ocr/core/runtime.wasm.js"
printf 'OCR-SPRACHE-FIXTURE\n' > "$SERVER/assets/ocr/lang/deu.traineddata.gz"
printf 'ENV-GEHEIMNIS-DARF-NICHT-IN-DAS-QUELLARCHIV\n' > "$SERVER/.env"
printf 'NODE-MODULE-DARF-NICHT-IN-DAS-QUELLARCHIV\n' > "$SERVER/node_modules/secret.js"
printf 'ALTBACKUP-DARF-NICHT-IN-DAS-QUELLARCHIV\n' > "$SERVER/_backups/secret.js"
printf 'DB-DARF-NICHT-IN-DAS-QUELLARCHIV\n' > "$SERVER/fixture.sqlite3"
printf 'LOG-DARF-NICHT-IN-DAS-QUELLARCHIV\n' > "$SERVER/server.log"
printf 'PASSWORT-DARF-NICHT-IN-DAS-QUELLARCHIV\n' > "$SERVER/restic-password"

printf 'Fallakte extern\n' > "$FALLWURZEL/case-file-a1b2.pdf"
printf 'Buero extern\n' > "$EXTERN/office-file"
printf 'Geloeschtes Dokument\n' > "$DATA/files/deleted-file"
printf 'Vorherige Version\n' > "$DATA/files/version-file"
printf 'Waise ohne DB-Zeile\n' > "$DATA/files/orphan-uuid"
printf 'Kuenftiges Modul\n' > "$DATA/custom-hidden/payload.bin"
printf 'Echter Klarname auf Platte\n' > "$CENTRAL_CASE/00 - Eingang/260701 Ärger, Anna Eingang.txt"
printf 'Erzeugter Fallbericht\n' > "$DATA/case-documents/case-1/case-export"
printf 'Geteiltes Besuchsfoto\n' > "$DATA/case-doku-photos/case-1/entry-1/photo-shared"
printf 'Posteingang\n' > "$DATA/inbox-documents/inbox-1"
printf 'Rechnung\n' > "$DATA/finance-receipts/receipt-1"
printf 'Kontoauszug\n' > "$DATA/finance-statements/statement-1"
printf 'Aufgabenanlage\n' > "$DATA/todo-attachments/todo-1/todo-att-1"
printf 'Kalenderanlage\n' > "$DATA/calendar-event-attachments/event-1/cal-att-1"
printf 'PNG-FIXTURE\n' > "$DATA/office-logo/logo-uuid.png"
RECOVERY_FP=$(RECOVERY_KEY="$RUNTIME_SECRET_SENTINEL" SECURE_JSON="$SECURE_JSON_QUELLE" \
  node -e "process.stdout.write(require(process.env.SECURE_JSON).fingerprint(process.env.RECOVERY_KEY))")
erzeuge_recovery_abbilder() {
RECOVERY_KEY="$RUNTIME_SECRET_SENTINEL" SECURE_JSON="$SECURE_JSON_QUELLE" \
  BACKUP_DATA="$TOOLS_DIR/../src/modules/backup/portable-data.js" \
  KEY_ID="$RECOVERY_KEY_ID" GENERATION_ID="$RECOVERY_GENERATION_ID" \
  SOURCE_REVISION="$RECOVERY_SOURCE_REVISION" \
  SECURITY_OUTPUT="$CENTRAL_MANAGEMENT/260728 0230 Sicherheit.json.enc" \
  CREDENTIALS_OUTPUT="$CENTRAL_MANAGEMENT/260728 0230 Zugangsdaten.json.enc" \
  node <<'NODE'
const fs = require('fs');
const secure = require(process.env.SECURE_JSON);
const backupData = require(process.env.BACKUP_DATA);
const metadata = {
  keyId: process.env.KEY_ID,
  generationId: process.env.GENERATION_ID,
  sourceRevision: process.env.SOURCE_REVISION
};
function write(file, schema, type, artifactScope) {
  const payload = {
    type,
    version: 3,
    portableSecrets: true,
    recoveryGeneration: {
      generationId: metadata.generationId,
      sourceRevision: metadata.sourceRevision,
      artifactScope
    },
    recoverySchema: backupData.recoverySchemaContract(artifactScope),
    omittedTables: []
  };
  for (const definition of backupData.restoreDefinitions(
    artifactScope,
    artifactScope === 'security' ? { tokenDisposition: 'restore' } : undefined
  )) {
    payload[definition.key] = [];
  }
  if (artifactScope === 'security') payload.caseOwners = [];
  fs.writeFileSync(file,
    JSON.stringify(secure.encryptJson(payload, process.env.RECOVERY_KEY, schema, metadata)) + '\n');
}
write(process.env.SECURITY_OUTPUT, 'security/3', 'betreuungsbuero-sicherheit', 'security');
write(process.env.CREDENTIALS_OUTPUT, 'credentials/3', 'betreuungsbuero-zugangsdaten', 'credentials');
NODE
}

# Stufe-4-Fixture: alle sieben Fachmodule und das geteilte Doku-Foto liegen
# ausschliesslich zentral. Die Fachzeilen zeigen ueber doc_links auf denselben
# Dateiinhalt; in den Legacy-Verzeichnissen bleibt bewusst keine zweite Kopie.
CENTRAL_CASE_DOC=$CENTRAL_CASE/11\ -\ Betreuungsführung/Dokumentenausgang/2026/06/260620\ Ärger,\ Anna\ Jahresbericht.pdf
CENTRAL_DOKU=$CENTRAL_CASE/11\ -\ Betreuungsführung/Falldokumentation/2026/06/260615\ 1352\ Hausbesuch/Besuchsfoto.jpg
CENTRAL_INBOX=$CENTRAL_OFFICE/Posteingang/2026/06/260617\ Eingangsschreiben.pdf
CENTRAL_RECEIPT=$CENTRAL_OFFICE/Finanzen/Belege/2026/06/260619\ Rechnung.pdf
CENTRAL_STATEMENT=$CENTRAL_OFFICE/Finanzen/Kontoauszüge/2026/06/260630\ Kontoauszug.pdf
CENTRAL_TODO=$CENTRAL_OFFICE/Termine\ \&\ Aufgaben/2026/06/Aufgabenunterlage.pdf
CENTRAL_CALENDAR=$CENTRAL_OFFICE/Termine\ \&\ Aufgaben/2026/06/Terminunterlage.pdf
CENTRAL_LOGO=$CENTRAL_OFFICE/Stammdaten/logo-uuid.png
for ziel in \
  "$CENTRAL_CASE_DOC" "$CENTRAL_DOKU" "$CENTRAL_INBOX" "$CENTRAL_RECEIPT" \
  "$CENTRAL_STATEMENT" "$CENTRAL_TODO" "$CENTRAL_CALENDAR" "$CENTRAL_LOGO"; do
  mkdir -p -- "$(dirname -- "$ziel")"
done
cp -p -- "$DATA/case-documents/case-1/case-export" "$CENTRAL_CASE_DOC"
cp -p -- "$DATA/case-doku-photos/case-1/entry-1/photo-shared" "$CENTRAL_DOKU"
cp -p -- "$DATA/inbox-documents/inbox-1" "$CENTRAL_INBOX"
cp -p -- "$DATA/finance-receipts/receipt-1" "$CENTRAL_RECEIPT"
cp -p -- "$DATA/finance-statements/statement-1" "$CENTRAL_STATEMENT"
cp -p -- "$DATA/todo-attachments/todo-1/todo-att-1" "$CENTRAL_TODO"
cp -p -- "$DATA/calendar-event-attachments/event-1/cal-att-1" "$CENTRAL_CALENDAR"
cp -p -- "$DATA/office-logo/logo-uuid.png" "$CENTRAL_LOGO"
rm -f -- \
  "$DATA/case-documents/case-1/case-export" \
  "$DATA/case-doku-photos/case-1/entry-1/photo-shared" \
  "$DATA/inbox-documents/inbox-1" \
  "$DATA/finance-receipts/receipt-1" \
  "$DATA/finance-statements/statement-1" \
  "$DATA/todo-attachments/todo-1/todo-att-1" \
  "$DATA/calendar-event-attachments/event-1/cal-att-1" \
  "$DATA/office-logo/logo-uuid.png"

EXT_SQL=$(sql_text "$EXTERN")
CASE_SQL=$(sql_text "$FALLWURZEL")
STORAGE_SQL=$(sql_text "$STORAGE_ROOT")
CASE_SHA=$(sha "$FALLWURZEL/case-file-a1b2.pdf")
OFFICE_SHA=$(sha "$EXTERN/office-file")
DELETED_SHA=$(sha "$DATA/files/deleted-file")
VERSION_SHA=$(sha "$DATA/files/version-file")
TRUE_SHA=$(sha "$CENTRAL_CASE/00 - Eingang/260701 Ärger, Anna Eingang.txt")
CASE_DOC_SHA=$(sha "$CENTRAL_CASE_DOC")
DOKU_SHA=$(sha "$CENTRAL_DOKU")
INBOX_SHA=$(sha "$CENTRAL_INBOX")
RECEIPT_SHA=$(sha "$CENTRAL_RECEIPT")
STATEMENT_SHA=$(sha "$CENTRAL_STATEMENT")
TODO_SHA=$(sha "$CENTRAL_TODO")
CALENDAR_SHA=$(sha "$CENTRAL_CALENDAR")
LOGO_SHA=$(sha "$CENTRAL_LOGO")
SECURITY_IMAGE=$CENTRAL_MANAGEMENT/260728\ 0230\ Sicherheit.json.enc
CREDENTIALS_IMAGE=$CENTRAL_MANAGEMENT/260728\ 0230\ Zugangsdaten.json.enc

sqlite3 "$DB" <<SQL
PRAGMA journal_mode=WAL;
CREATE TABLE office_json (
  key TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO office_json(key,data_json) VALUES(
  'documents_config',
  json_object('storageRoot','$STORAGE_SQL','baseDir','$EXT_SQL',
              'caseDirs',json_object('case-1','$CASE_SQL'))
);

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  stammdaten_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO cases(id,label,stammdaten_json)
VALUES('case-1','Ärger, Anna',json_object('person',json_object('birthDate','1980-04-03')));

CREATE TABLE doc_folders (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  case_id TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO doc_folders VALUES
  ('f03','case','case-1','','03 - Behörden & Gerichte',3),
  ('famt','case','case-1','f03','Amtsgericht Köln',0),
  ('fjahr','case','case-1','famt','2026',0),
  ('fmonat','case','case-1','fjahr','06',0);
INSERT INTO doc_folders VALUES
  ('f11','case','case-1','','11 - Betreuungsführung',11),
  ('fdocout','case','case-1','f11','Dokumentenausgang',0),
  ('fdocy','case','case-1','fdocout','2026',0),
  ('fdocm','case','case-1','fdocy','06',0),
  ('fdoku','case','case-1','f11','Falldokumentation',0),
  ('fdy','case','case-1','fdoku','2026',0),
  ('fdm','case','case-1','fdy','06',0),
  ('fdentry','case','case-1','fdm','260615 1352 Hausbesuch',0),
  ('opost','office','','','Posteingang',0),
  ('opy','office','','opost','2026',0),
  ('opm','office','','opy','06',0),
  ('ofin','office','','','Finanzen',0),
  ('obeleg','office','','ofin','Belege',0),
  ('oby','office','','obeleg','2026',0),
  ('obm','office','','oby','06',0),
  ('ostmt','office','','ofin','Kontoauszüge',0),
  ('osy','office','','ostmt','2026',0),
  ('osm','office','','osy','06',0),
  ('ota','office','','','Termine & Aufgaben',0),
  ('otay','office','','ota','2026',0),
  ('otam','office','','otay','06',0),
  ('ostamm','office','','','Stammdaten',0);

CREATE TABLE doc_files (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  case_id TEXT NOT NULL DEFAULT '',
  folder_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL DEFAULT '',
  storage_relpath TEXT NOT NULL DEFAULT '',
  artifact_kind TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'standard',
  managed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
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
  PRIMARY KEY(scope_type,scope_id,artifact_kind)
);
INSERT INTO doc_files(id,area,case_id,folder_id,name,mime_type,size,sha256) VALUES
  ('case-file','case','case-1','fmonat','260615 Ärger, Anna Beschluss.pdf','application/pdf',
   $(groesse "$FALLWURZEL/case-file-a1b2.pdf"),'$CASE_SHA'),
  ('office-file','office','','','Büroplan.pdf','application/pdf',
   $(groesse "$EXTERN/office-file"),'$OFFICE_SHA');
INSERT INTO doc_files(id,area,case_id,folder_id,name,mime_type,size,sha256,deleted_at) VALUES
  ('deleted-file','case','case-1','','260101 alter Entwurf.txt','text/plain',
   $(groesse "$DATA/files/deleted-file"),'$DELETED_SHA','2026-07-01 12:00:00');
INSERT INTO doc_files(id,area,case_id,folder_id,name,mime_type,size,sha256,storage_relpath) VALUES
  ('true-file','case','case-1','','260701 Ärger, Anna Eingang.txt','text/plain',
   $(groesse "$CENTRAL_CASE/00 - Eingang/260701 Ärger, Anna Eingang.txt"),
   '$TRUE_SHA','Fallakten/A/Ärger, Anna/00 - Eingang/260701 Ärger, Anna Eingang.txt');
INSERT INTO doc_files(id,area,case_id,folder_id,name,mime_type,size,sha256,storage_relpath) VALUES
  ('central-case-document','case','case-1','fdocm','260620 Ärger, Anna Jahresbericht.pdf','application/pdf',
   $(groesse "$CENTRAL_CASE_DOC"),'$CASE_DOC_SHA',
   'Fallakten/A/Ärger, Anna/11 - Betreuungsführung/Dokumentenausgang/2026/06/260620 Ärger, Anna Jahresbericht.pdf'),
  ('central-doku','case','case-1','fdentry','Besuchsfoto.jpg','image/jpeg',
   $(groesse "$CENTRAL_DOKU"),'$DOKU_SHA',
   'Fallakten/A/Ärger, Anna/11 - Betreuungsführung/Falldokumentation/2026/06/260615 1352 Hausbesuch/Besuchsfoto.jpg'),
  ('central-inbox','office','','opm','260617 Eingangsschreiben.pdf','application/pdf',
   $(groesse "$CENTRAL_INBOX"),'$INBOX_SHA',
   'Büroorganisation/Posteingang/2026/06/260617 Eingangsschreiben.pdf'),
  ('central-receipt','office','','obm','260619 Rechnung.pdf','application/pdf',
   $(groesse "$CENTRAL_RECEIPT"),'$RECEIPT_SHA',
   'Büroorganisation/Finanzen/Belege/2026/06/260619 Rechnung.pdf'),
  ('central-statement','office','','osm','260630 Kontoauszug.pdf','application/pdf',
   $(groesse "$CENTRAL_STATEMENT"),'$STATEMENT_SHA',
   'Büroorganisation/Finanzen/Kontoauszüge/2026/06/260630 Kontoauszug.pdf'),
  ('central-todo','office','','otam','Aufgabenunterlage.pdf','application/pdf',
   $(groesse "$CENTRAL_TODO"),'$TODO_SHA',
   'Büroorganisation/Termine & Aufgaben/2026/06/Aufgabenunterlage.pdf'),
  ('central-calendar','office','','otam','Terminunterlage.pdf','application/pdf',
   $(groesse "$CENTRAL_CALENDAR"),'$CALENDAR_SHA',
   'Büroorganisation/Termine & Aufgaben/2026/06/Terminunterlage.pdf'),
  ('central-logo','office','','ostamm','logo-uuid.png','image/png',
   $(groesse "$CENTRAL_LOGO"),'$LOGO_SHA',
   'Büroorganisation/Stammdaten/logo-uuid.png');

CREATE TABLE doc_links (
  module TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  slot TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (module, owner_id, slot)
);
INSERT INTO doc_links(module,owner_id,slot,file_id) VALUES
  ('case-document','case-export','','central-case-document'),
  ('doku-photo','entry-1','photo-shared','central-doku'),
  ('doku-photo','entry-2','photo-shared','central-doku'),
  ('inbox','inbox-1','','central-inbox'),
  ('finance-receipt','receipt-1','','central-receipt'),
  ('finance-statement','statement-1','','central-statement'),
  ('todo-attachment','todo-1','todo-att-1','central-todo'),
  ('calendar-attachment','event-1','cal-att-1','central-calendar'),
  ('office-logo','default','','central-logo');

CREATE TABLE doc_versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO doc_versions(id,file_id,name,mime_type,size,sha256)
VALUES('version-file','case-file','260501 Ärger, Anna Beschluss.pdf','application/pdf',
       $(groesse "$DATA/files/version-file"),'$VERSION_SHA');

CREATE TABLE case_documents (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, filename TEXT NOT NULL,
  mime_type TEXT NOT NULL, size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO case_documents VALUES(
  'case-export','case-1','260620 Ärger, Anna Jahresbericht.pdf','application/pdf',
  $(groesse "$CENTRAL_CASE_DOC"),'2026-06-20 09:15:00'
);

CREATE TABLE case_doku_entries (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO case_doku_entries VALUES
  ('entry-1','case-1',
   json_object('datum','15.06.2026','type','Hausbesuch',
     'photos',json_array(json_object('id','photo-shared','filename','Besuchsfoto.jpg',
       'size',$(groesse "$CENTRAL_DOKU")))),
   '2026-07-24 13:52:00'),
  ('entry-2','case-1',
   json_object('date','2026-06-16','type','Telefonat',
     'photos',json_array(json_object('id','photo-shared','filename','Besuchsfoto.jpg',
       'size',$(groesse "$CENTRAL_DOKU")))),
   '2026-07-24 14:10:00');

CREATE TABLE inbox_documents (
  id TEXT PRIMARY KEY, file_name TEXT NOT NULL, size INTEGER NOT NULL,
  received_date TEXT NOT NULL, inbox_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO inbox_documents VALUES(
  'inbox-1','260617 Eingangsschreiben.pdf',$(groesse "$CENTRAL_INBOX"),
  '2026-06-17','2026-06-18','2026-06-18 08:00:00'
);

CREATE TABLE finance_receipts (
  id TEXT PRIMARY KEY, filename TEXT NOT NULL, size INTEGER NOT NULL,
  invoice_date TEXT NOT NULL, uploaded_at TEXT NOT NULL
);
INSERT INTO finance_receipts VALUES(
  'receipt-1','260619 Rechnung.pdf',$(groesse "$CENTRAL_RECEIPT"),
  '2026-06-19','2026-06-20 08:00:00'
);

CREATE TABLE finance_statements (
  id TEXT PRIMARY KEY, filename TEXT NOT NULL, size INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);
INSERT INTO finance_statements VALUES(
  'statement-1','260630 Kontoauszug.pdf',$(groesse "$CENTRAL_STATEMENT"),
  '2026-06-30 08:00:00'
);

CREATE TABLE calendar_event_attachments (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, filename TEXT NOT NULL,
  size INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO calendar_event_attachments VALUES(
  'cal-att-1','event-1','Terminunterlage.pdf',
  $(groesse "$CENTRAL_CALENDAR"),'2026-06-21 10:00:00'
);

CREATE TABLE todo_attachments (
  id TEXT PRIMARY KEY, todo_id TEXT NOT NULL, filename TEXT NOT NULL,
  size INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO todo_attachments VALUES(
  'todo-att-1','todo-1','Aufgabenunterlage.pdf',
  $(groesse "$CENTRAL_TODO"),'2026-06-22 10:00:00'
);

CREATE TABLE office_profile (
  id INTEGER PRIMARY KEY, logo_filename TEXT NOT NULL, logo_mime_type TEXT NOT NULL
);
INSERT INTO office_profile VALUES(1,'logo-uuid.png','image/png');

CREATE TABLE wal_probe(value TEXT NOT NULL);
SQL

# Die Sicherheitsabbilder müssen nicht nur untereinander, sondern auch mit dem
# tatsächlich gesicherten fachlichen Recovery-Zustand übereinstimmen. Das
# Fixture ergänzt dafür den exakten Schema-Vertrag und berechnet dieselbe
# portable Quellrevision wie der Produktionsgenerator.
RECOVERY_SOURCE_REVISION=$( \
  RECOVERY_DB="$DB" BACKUP_DATA="$TOOLS_DIR/../src/modules/backup/portable-data.js" \
  CRYPTO_HELPER="$TOOLS_DIR/../src/security/crypto.js" \
  BETTER_SQLITE="$TOOLS_DIR/../node_modules/better-sqlite3" \
  node <<'NODE'
const Database = require(process.env.BETTER_SQLITE);
const backupData = require(process.env.BACKUP_DATA);
const db = new Database(process.env.RECOVERY_DB);
for (const scope of ['security', 'credentials']) {
  const contract = backupData.recoverySchemaContract(scope);
  for (const [table, columns] of Object.entries(contract.tables)) {
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);
    if (!exists) {
      db.exec(`CREATE TABLE "${table}" (`
        + columns.map((column) => `"${column}" TEXT`).join(',')
        + ')');
    }
  }
}
const caseColumns = db.prepare('PRAGMA table_info("cases")').all()
  .map((column) => String(column.name || ''));
if (!caseColumns.includes('owner_user_id')) {
  db.exec('ALTER TABLE "cases" ADD COLUMN "owner_user_id" TEXT');
}
process.stdout.write(backupData.portableRecoverySourceRevision(
  db, require(process.env.CRYPTO_HELPER)
));
db.close();
NODE
)
[[ $RECOVERY_SOURCE_REVISION =~ ^[0-9a-f]{64}$ ]] ||
  scheitern "Portable Recovery-Quellrevision des Fixtures ist ungültig."
erzeuge_recovery_abbilder
SECURITY_SHA=$(sha "$SECURITY_IMAGE")
CREDENTIALS_SHA=$(sha "$CREDENTIALS_IMAGE")

# Eine offene, rein lokale Fixture-Verbindung haelt einen nachweislich nicht
# eingecheckten Datensatz im WAL, waehrend das Backup laeuft.
FIFO=$TMP/sqlite-input.fifo
SQL_LOG=$TMP/sqlite-holder.log
mkfifo "$FIFO"
sqlite3 -batch "$DB" < "$FIFO" > "$SQL_LOG" 2>&1 &
SQLITE_PID=$!
exec 9>"$FIFO"
printf '%s\n' \
  'PRAGMA journal_mode=WAL;' \
  'PRAGMA wal_autocheckpoint=0;' \
  "INSERT INTO wal_probe(value) VALUES('im-wal');" \
  '.print WAL_READY' >&9

READY=nein
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if grep -q WAL_READY "$SQL_LOG" 2>/dev/null && [[ -s $DB-wal ]]; then
    READY=ja
    break
  fi
  sleep 0.1
done
[[ $READY == ja ]] || scheitern "WAL-Fixture wurde nicht bereit."

mkdir -p "$BACKUP_ZIEL"
# Ein automatischer Lauf mit Zielmarke darf bei einem nur scheinbar vorhandenen
# Mountpunkt nicht auf die interne Platte ausweichen.
set +e
MARKER_FEHLT_AUSGABE=$(bash "$BACKUP" \
  --db "$DB" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL" \
  --require-marker \
  --label marker-fehlt 2>&1)
MARKER_FEHLT_RC=$?
set -e
[[ $MARKER_FEHLT_RC -ne 0 ]] ||
  scheitern "Automatischer Lauf ohne Zielmarke haette scheitern muessen."
[[ $MARKER_FEHLT_AUSGABE == *".betreuungsbuero-backup-ziel"* ]] ||
  scheitern "Fehlende Zielmarke wurde nicht verstaendlich gemeldet."
[[ -z $(find "$BACKUP_ZIEL" -mindepth 1 -maxdepth 1 -type d -name 'Gesamtsicherung_*' -print) ]] ||
  scheitern "Ohne Zielmarke wurde trotzdem ein Snapshot angelegt."

: > "$BACKUP_ZIEL/.betreuungsbuero-backup-ziel"
set +e
LEERE_MARKER_AUSGABE=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL" --require-marker \
  --label leere-zielmarke 2>&1)
LEERE_MARKER_RC=$?
set -e
[[ $LEERE_MARKER_RC -ne 0 &&
   $LEERE_MARKER_AUSGABE == *"Zielmarke fehlt, ist ungueltig oder nicht eindeutig"* &&
   ! -s $BACKUP_ZIEL/.betreuungsbuero-backup-ziel ]] ||
  scheitern "Eine leere Zielmarke wurde still aufgewertet oder unklar gemeldet."

FIXTURE_TARGET_ID=11111111-1111-4111-8111-111111111111
{
  printf 'Betreuungsbuero-Backupziel/1\n'
  printf 'TARGET_ID=%s\n' "$FIXTURE_TARGET_ID"
  printf 'CREATED_AT=2026-07-28T00:00:00Z\n'
} > "$BACKUP_ZIEL/.betreuungsbuero-backup-ziel"

# Default ist strikt: Ohne die beiden portablen Schema-3-Abbilder darf selbst
# diese ansonsten vollständige Fixture nicht VOLLSTAENDIG melden.
mkdir -p "$BACKUP_ZIEL_STRICT"
FREMD_DIAGNOSE=$BACKUP_ZIEL_STRICT/Gesamtsicherung_19990101_010101_fremd_UNVOLLSTAENDIG
mkdir -p "$FREMD_DIAGNOSE"
printf 'UNVOLLSTAENDIG\n' > "$FREMD_DIAGNOSE/STATUS.txt"
printf 'fremdes-manifest\n' > "$FREMD_DIAGNOSE/MANIFEST.tsv"
set +e
STRICT_AUSGABE=$(bash "$BACKUP" \
  --db "$DB" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_STRICT" \
  --consistency-retries 3 \
  --retention-diagnostic 2 \
  --label strikt 2>&1)
STRICT_RC=$?
set -e
[[ $STRICT_RC -eq 2 ]] ||
  scheitern "Fehlende Sicherheitsabbilder haetten Code 2 liefern muessen (war $STRICT_RC)."
[[ $STRICT_AUSGABE == *"KONSISTENZVERSUCH=4/4"* ]] ||
  scheitern "Begrenzte Konsistenzwiederholung wurde nicht ausgefuehrt."
STRICT_DIAGNOSE_COUNT=$(printf '%s\n' "$STRICT_AUSGABE" |
  awk '/^DIAGNOSE_SNAPSHOT=/{n++} END{print n+0}')
STRICT_FINAL_COUNT=$(printf '%s\n' "$STRICT_AUSGABE" |
  awk '/^SNAPSHOT=/{n++} END{print n+0}')
[[ $STRICT_DIAGNOSE_COUNT -eq 4 ]] ||
  scheitern "Jeder unvollstaendige Versuch muss genau einen Diagnose-Snapshot melden. Ausgabe: $STRICT_AUSGABE"
[[ $STRICT_FINAL_COUNT -eq 0 ]] ||
  scheitern "Ein unvollstaendiger Versuch darf kein finales SNAPSHOT-Signal ausgeben."
STRICT_COUNT=$(find "$BACKUP_ZIEL_STRICT" -type d -name 'Gesamtsicherung_*_strikt_UNVOLLSTAENDIG*' -print |
  wc -l | tr -d ' ')
[[ $STRICT_COUNT -eq 2 ]] ||
  scheitern "Diagnose-Retention haette trotz vier Versuchen genau zwei eigene Snapshots behalten muessen."
[[ -d $FREMD_DIAGNOSE ]] ||
  scheitern "Diagnose-Retention hat einen fremden Ordner ohne eigenen Formatmarker entfernt."
STRICT_SNAPSHOT=$(find "$BACKUP_ZIEL_STRICT" -type d \
  -name 'Gesamtsicherung_*_strikt_UNVOLLSTAENDIG*' -print | sed -n '1p')
[[ -n $STRICT_SNAPSHOT ]] || scheitern "Strikter Lauf hat keinen sichtbaren unvollstaendigen Snapshot erzeugt."
grep -q "Pflicht-Materialisierung 'security-encrypted' fehlt" "$STRICT_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Fehlende Pflichtabbilder wurden nicht im Pruefbericht benannt."

# Jetzt werden zwei eindeutige, erfolgreiche Schema-3-Materialisierungen
# eingetragen. Der reguläre Lauf muss deren DB-/Dateihash, Schema und gemeinsamen
# Recovery-Key-Fingerabdruck streng bestätigen.
sqlite3 "$DB" <<SQL
INSERT INTO doc_files
  (id,area,case_id,folder_id,name,mime_type,size,sha256,storage_relpath,
   artifact_kind,visibility,managed)
VALUES
  ('security-image','management','','','260728 0230 Sicherheit.json.enc','application/json',
   $(groesse "$SECURITY_IMAGE"),'$SECURITY_SHA',
   'Büroorganisation/_Verwaltung & Sicherungen/260728 0230 Sicherheit.json.enc',
   'security-encrypted','admin',1),
  ('credentials-image','management','','','260728 0230 Zugangsdaten.json.enc','application/json',
   $(groesse "$CREDENTIALS_IMAGE"),'$CREDENTIALS_SHA',
   'Büroorganisation/_Verwaltung & Sicherungen/260728 0230 Zugangsdaten.json.enc',
   'credentials-encrypted','admin',1);
INSERT INTO doc_materializations
  (scope_type,scope_id,artifact_kind,file_id,source_revision,sha256,status,last_error,generated_at)
VALUES
  ('office','','security-encrypted','security-image','$RECOVERY_SOURCE_REVISION',
   '$SECURITY_SHA','ok','','2026-07-28T02:30:00.000Z'),
  ('office','','credentials-encrypted','credentials-image','$RECOVERY_SOURCE_REVISION',
   '$CREDENTIALS_SHA','ok','','2026-07-28T02:30:00.000Z');
SQL

# Ein sauber signiertes, zusammengehöriges, aber fachlich veraltetes Paar darf
# nicht als vollständige Gesamtsicherung gelten. Nach Rücknahme der Änderung
# stimmt dieselbe Fixture-Generation wieder exakt.
STALE_RECOVERY_ZIEL=$TMP/snapshots-recovery-veraltet
mkdir -p "$STALE_RECOVERY_ZIEL"
sqlite3 "$DB" \
  "INSERT INTO mail_prefs(user_id,prefs_json,updated_at) VALUES('u-stale','{}','2026-07-28T03:00:00Z');"
set +e
STALE_RECOVERY_AUSGABE=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$STALE_RECOVERY_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --consistency-retries 0 --label recovery-veraltet 2>&1)
STALE_RECOVERY_RC=$?
set -e
sqlite3 "$DB" "DELETE FROM mail_prefs WHERE user_id='u-stale';"
STALE_RECOVERY_SNAPSHOT=$(find "$STALE_RECOVERY_ZIEL" -maxdepth 1 -type d \
  -name 'Gesamtsicherung_*_recovery-veraltet_UNVOLLSTAENDIG*' -print | sed -n '1p')
[[ $STALE_RECOVERY_RC -eq 2 && -n $STALE_RECOVERY_SNAPSHOT ]] &&
  grep -q "Recovery-Abbilder sind gegenueber der SQLite-Sicherung veraltet" \
    "$STALE_RECOVERY_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Veraltete, aber intern gültige Recovery-Abbilder wurden nicht fail-closed erkannt: $STALE_RECOVERY_AUSGABE"

# Laufzeitdateien, die für einen reproduzierbaren Container-Neuaufbau benötigt
# werden, sind keine optionale Dokumentation. Insbesondere .dockerignore muss
# fail-closed behandelt werden, weil sonst beim Wiederaufbau Daten und Secrets
# in den Docker-Build-Kontext geraten könnten.
PFLICHT_KONFIG_ZIEL=$TMP/snapshots-pflicht-konfiguration
mkdir -p "$PFLICHT_KONFIG_ZIEL"
mv -- "$SERVER/.dockerignore" "$SERVER/.dockerignore.voruebergehend"
set +e
PFLICHT_KONFIG_AUSGABE=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$PFLICHT_KONFIG_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --consistency-retries 0 --label pflicht-konfiguration 2>&1)
PFLICHT_KONFIG_RC=$?
set -e
mv -- "$SERVER/.dockerignore.voruebergehend" "$SERVER/.dockerignore"
PFLICHT_KONFIG_SNAPSHOT=$(find "$PFLICHT_KONFIG_ZIEL" -maxdepth 1 -type d \
  -name 'Gesamtsicherung_*_pflicht-konfiguration_UNVOLLSTAENDIG*' -print | sed -n '1p')
[[ $PFLICHT_KONFIG_RC -eq 2 && -n $PFLICHT_KONFIG_SNAPSHOT ]] &&
  grep -q "Pflicht-Betriebskonfiguration '.dockerignore' fehlt" \
    "$PFLICHT_KONFIG_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Fehlende .dockerignore wurde nicht fail-closed erkannt: $PFLICHT_KONFIG_AUSGABE"

# Eine vorhandene, aber beschädigte documents_config darf nicht wie eine leere
# Konfiguration behandelt werden; sonst würden externe Wurzeln still fehlen.
INVALID_CONFIG_ZIEL=$TMP/snapshots-invalid-config
mkdir -p "$INVALID_CONFIG_ZIEL"
sqlite3 "$DB" "UPDATE office_json SET data_json='{kaputt' WHERE key='documents_config';"
set +e
INVALID_CONFIG_AUSGABE=$(bash "$BACKUP" --db "$DB" --data-dir "$DATA" \
  --server-dir "$SERVER" --destination "$INVALID_CONFIG_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --consistency-retries 0 --label invalid-config 2>&1)
INVALID_CONFIG_RC=$?
set -e
[[ $INVALID_CONFIG_RC -eq 2 &&
   $INVALID_CONFIG_AUSGABE == *"documents_config konnte vor der SQLite-Sicherung nicht stabil gelesen werden"* ]] ||
  scheitern "Beschädigte documents_config wurde nicht fail-closed abgelehnt: $INVALID_CONFIG_AUSGABE"
sqlite3 "$DB" "
  UPDATE office_json
     SET data_json=json_object(
       'storageRoot','$STORAGE_SQL',
       'baseDir','$EXT_SQL',
       'caseDirs',json_object('case-1','$CASE_SQL'))
   WHERE key='documents_config';"

# Die Vorher-Signatur externer documents_config-Wurzeln muss bereits vor
# SQLite `.backup` stehen. Eine genau während der DB-Kopie ausgelöste
# Änderung darf deshalb niemals als vollständige Generation erscheinen.
EXTERN_RACE_ZIEL=$TMP/snapshots-external-race
EXTERN_RACE_BIN=$TMP/external-race-bin
EXTERN_RACE_ONCE=$TMP/external-race-once
EXTERN_RACE_REAL_SQLITE=$(command -v sqlite3)
EXTERN_RACE_DATEI=$EXTERN/office-file
EXTERN_RACE_DB_ORDNER=$(CDPATH= cd -- "$(dirname -- "$DB")" && pwd -P)
EXTERN_RACE_DB_KANON=$EXTERN_RACE_DB_ORDNER/${DB##*/}
mkdir -p "$EXTERN_RACE_ZIEL" "$EXTERN_RACE_BIN"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ $# -eq 2 && $1 == -batch && $2 == "$EXTERN_RACE_DB" ]]; then' \
  '  eingabe=$(mktemp "${TMPDIR:-/tmp}/external-race-sql.XXXXXXXX")' \
  '  trap '"'"'rm -f -- "$eingabe"'"'"' EXIT' \
  '  cat > "$eingabe"' \
  '  if grep -q '"'"'^\.backup '"'"' "$eingabe" && [[ ! -e $EXTERN_RACE_ONCE ]]; then' \
  '    printf "AENDERUNG-WAEHREND-DB-BACKUP\\n" >> "$EXTERN_RACE_DATEI"' \
  '    : > "$EXTERN_RACE_ONCE"' \
  '  fi' \
  '  exec "$EXTERN_RACE_REAL_SQLITE" "$@" < "$eingabe"' \
  'fi' \
  'exec "$EXTERN_RACE_REAL_SQLITE" "$@"' \
  > "$EXTERN_RACE_BIN/sqlite3"
chmod 700 "$EXTERN_RACE_BIN/sqlite3"
set +e
EXTERN_RACE_AUSGABE=$(PATH="$EXTERN_RACE_BIN:$PATH" \
  EXTERN_RACE_DB="$EXTERN_RACE_DB_KANON" EXTERN_RACE_DATEI="$EXTERN_RACE_DATEI" \
  EXTERN_RACE_ONCE="$EXTERN_RACE_ONCE" \
  EXTERN_RACE_REAL_SQLITE="$EXTERN_RACE_REAL_SQLITE" \
  bash "$BACKUP" --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$EXTERN_RACE_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --consistency-retries 0 --label external-race 2>&1)
EXTERN_RACE_RC=$?
set -e
[[ $EXTERN_RACE_RC -eq 2 && -f $EXTERN_RACE_ONCE ]] ||
  scheitern "Änderung einer externen Wurzel während SQLite .backup wurde nicht fail-closed erkannt: $EXTERN_RACE_AUSGABE"
EXTERN_RACE_SNAPSHOT=$(find "$EXTERN_RACE_ZIEL" -maxdepth 1 -type d \
  -name 'Gesamtsicherung_*_external-race_UNVOLLSTAENDIG*' -print | sed -n '1p')
[[ -n $EXTERN_RACE_SNAPSHOT ]] &&
  grep -q 'externe Dokumentwurzel hat sich waehrend der Kopie geaendert' \
    "$EXTERN_RACE_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Der externe DB-Zeitzaun ist im Diagnosebericht nicht belegt."
printf 'Buero extern\n' > "$EXTERN_RACE_DATEI"

# Direkte Shell-/cron-Läufe besitzen nicht die Upload-Barriere der App. Auch
# Erweiterungspakete müssen daher vor und nach tar identisch sein.
RUNTIME_RACE_ZIEL=$TMP/snapshots-runtime-race
RUNTIME_RACE_BIN=$TMP/runtime-race-bin
RUNTIME_RACE_ONCE=$TMP/runtime-race-once
RUNTIME_RACE_REAL_TAR=$(command -v tar)
RUNTIME_RACE_QUELLE=$(CDPATH= cd -- "$SERVER/extension-artifacts" && pwd -P)
mkdir -p "$RUNTIME_RACE_ZIEL" "$RUNTIME_RACE_BIN"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ ${1:-} == -C && ${2:-} == "$RUNTIME_RACE_QUELLE" && ! -e $RUNTIME_RACE_ONCE ]]; then' \
  '  printf "AENDERUNG-WAEHREND-TAR\\n" >> "$RUNTIME_RACE_QUELLE/firefox__test.xpi"' \
  '  : > "$RUNTIME_RACE_ONCE"' \
  'fi' \
  'exec "$RUNTIME_RACE_REAL_TAR" "$@"' \
  > "$RUNTIME_RACE_BIN/tar"
chmod 700 "$RUNTIME_RACE_BIN/tar"
set +e
RUNTIME_RACE_AUSGABE=$(PATH="$RUNTIME_RACE_BIN:$PATH" \
  RUNTIME_RACE_QUELLE="$RUNTIME_RACE_QUELLE" \
  RUNTIME_RACE_ONCE="$RUNTIME_RACE_ONCE" \
  RUNTIME_RACE_REAL_TAR="$RUNTIME_RACE_REAL_TAR" \
  bash "$BACKUP" --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$RUNTIME_RACE_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --consistency-retries 0 --label runtime-race 2>&1)
RUNTIME_RACE_RC=$?
set -e
[[ $RUNTIME_RACE_RC -eq 2 && -f $RUNTIME_RACE_ONCE &&
   $RUNTIME_RACE_AUSGABE == *"Laufzeitbaum hat sich waehrend der Sicherung geaendert: runtime/extension-artifacts"* ]] ||
  scheitern "Änderung der Erweiterungspakete während tar wurde nicht fail-closed erkannt: $RUNTIME_RACE_AUSGABE"
printf 'SIGNIERTES-XPI\n' > "$SERVER/extension-artifacts/firefox__test.xpi"

# Eine Inhaltsänderung mit identischer Bytezahl und absichtlich
# zurückgesetzter mtime darf auf grob auflösenden NAS-Dateisystemen nicht durch
# die Metadatensignatur fallen. Der Datenbaum wird deshalb dateiweise gehasht.
GLEICHZEIT_ZIEL=$TMP/snapshots-same-size-mtime
GLEICHZEIT_BIN=$TMP/same-size-mtime-bin
GLEICHZEIT_ONCE=$TMP/same-size-mtime-once
GLEICHZEIT_DATEI=$DATA/same-size-mtime.bin
GLEICHZEIT_REAL_TAR=$(command -v tar)
GLEICHZEIT_DATA_KANON=$(CDPATH= cd -- "$DATA" && pwd -P)
mkdir -p "$GLEICHZEIT_ZIEL" "$GLEICHZEIT_BIN"
printf 'AAAA1111\n' > "$GLEICHZEIT_DATEI"
touch -t 202001010101.00 "$GLEICHZEIT_DATEI"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ ${1:-} == -C && ${2:-} == "$GLEICHZEIT_DATA" && ! -e $GLEICHZEIT_ONCE ]]; then' \
  '  printf "BBBB2222\\n" > "$GLEICHZEIT_DATEI"' \
  '  touch -t 202001010101.00 "$GLEICHZEIT_DATEI"' \
  '  : > "$GLEICHZEIT_ONCE"' \
  'fi' \
  'exec "$GLEICHZEIT_REAL_TAR" "$@"' \
  > "$GLEICHZEIT_BIN/tar"
chmod 700 "$GLEICHZEIT_BIN/tar"
set +e
GLEICHZEIT_AUSGABE=$(PATH="$GLEICHZEIT_BIN:$PATH" \
  GLEICHZEIT_DATA="$GLEICHZEIT_DATA_KANON" \
  GLEICHZEIT_DATEI="$GLEICHZEIT_DATEI" \
  GLEICHZEIT_ONCE="$GLEICHZEIT_ONCE" \
  GLEICHZEIT_REAL_TAR="$GLEICHZEIT_REAL_TAR" \
  bash "$BACKUP" --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$GLEICHZEIT_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --consistency-retries 0 --label same-size-mtime 2>&1)
GLEICHZEIT_RC=$?
set -e
GLEICHZEIT_SNAPSHOT=$(find "$GLEICHZEIT_ZIEL" -maxdepth 1 -type d \
  -name 'Gesamtsicherung_*_same-size-mtime_UNVOLLSTAENDIG*' -print | sed -n '1p')
[[ $GLEICHZEIT_RC -eq 2 && -f $GLEICHZEIT_ONCE && -n $GLEICHZEIT_SNAPSHOT ]] &&
  grep -q "Datenbaum hat sich zwischen SQLite-Sicherung und Dateikopie geaendert" \
    "$GLEICHZEIT_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Gleich große Datenänderung mit zurückgesetzter mtime wurde nicht erkannt: $GLEICHZEIT_AUSGABE"
rm -f -- "$GLEICHZEIT_DATEI"

# Der echte App-Runner muss einen ersten, absichtlich durch eine Datenbaum-
# Mutation unvollständigen Versuch überleben. Erst Versuch zwei darf genau eine
# lokale Freigabe und genau ein finales SNAPSHOT-Signal auslösen.
RUNNER_RETRY_ZIEL=$TMP/snapshots-runner-retry
RUNNER_RETRY_BIN=$TMP/runner-retry-bin
RUNNER_RETRY_ONCE=$TMP/runner-retry-once
RUNNER_RETRY_TARGET_ID=22222222-2222-4222-8222-222222222222
RUNNER_RETRY_REAL_TAR=$(command -v tar)
RUNNER_RETRY_DATA_KANON=$(CDPATH= cd -- "$DATA" && pwd -P)
mkdir -p "$RUNNER_RETRY_ZIEL" "$RUNNER_RETRY_BIN"
{
  printf 'Betreuungsbuero-Backupziel/1\n'
  printf 'TARGET_ID=%s\n' "$RUNNER_RETRY_TARGET_ID"
  printf 'CREATED_AT=2026-07-28T00:00:00Z\n'
} > "$RUNNER_RETRY_ZIEL/.betreuungsbuero-backup-ziel"
{
  printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail'
  printf 'RUNNER_RETRY_DATA=%q\n' "$RUNNER_RETRY_DATA_KANON"
  printf 'RUNNER_RETRY_ONCE=%q\n' "$RUNNER_RETRY_ONCE"
  printf 'RUNNER_RETRY_REAL_TAR=%q\n' "$RUNNER_RETRY_REAL_TAR"
  printf '%s\n' \
    'if [[ ${GESAMT_BACKUP_INNER_ATTEMPT:-} == 1 && ${1:-} == -C &&' \
    '      ${2:-} == "$RUNNER_RETRY_DATA" && ! -e $RUNNER_RETRY_ONCE ]]; then' \
    '  printf "erzwungene Konsistenzmutation\n" > "$RUNNER_RETRY_DATA/retry-mutation.txt"' \
    '  : > "$RUNNER_RETRY_ONCE"' \
    'fi' \
    'exec "$RUNNER_RETRY_REAL_TAR" "$@"'
} > "$RUNNER_RETRY_BIN/tar"
chmod 700 "$RUNNER_RETRY_BIN/tar"
set +e
RUNNER_RETRY_AUSGABE=$( \
  PATH="$RUNNER_RETRY_BIN:$PATH" \
  RUNNER="$RUNNER" \
  RUNNER_RETRY_DATA="$RUNNER_RETRY_DATA_KANON" \
  RUNNER_RETRY_ONCE="$RUNNER_RETRY_ONCE" \
  RUNNER_RETRY_REAL_TAR="$RUNNER_RETRY_REAL_TAR" \
  RUNNER_RETRY_ZIEL="$RUNNER_RETRY_ZIEL" \
  RUNNER_RETRY_TARGET_ID="$RUNNER_RETRY_TARGET_ID" \
  RUNNER_RETRY_SERVER="$SERVER" \
  RUNNER_RETRY_DB="$DB" \
  RUNNER_RETRY_BACKUP="$BACKUP" \
  RUNNER_RETRY_APP="$APP_FIXTURE" \
  RUNNER_RETRY_FP="$RECOVERY_FP" \
  node - <<'NODE' 2>&1
const fs = require('fs');
const path = require('path');
const { runTotalBackup } = require(process.env.RUNNER);

(async () => {
  let localReadyCount = 0;
  const result = await runTotalBackup({
    serverDir: process.env.RUNNER_RETRY_SERVER,
    dataDir: process.env.RUNNER_RETRY_DATA,
    dbPath: process.env.RUNNER_RETRY_DB,
    scriptPath: process.env.RUNNER_RETRY_BACKUP,
    destination: process.env.RUNNER_RETRY_ZIEL,
    expectedTargetId: process.env.RUNNER_RETRY_TARGET_ID,
    recoveryKeyFingerprint: process.env.RUNNER_RETRY_FP,
    appFile: process.env.RUNNER_RETRY_APP,
    consistencyRetries: 1,
    jobId: 'runner-retry',
    label: 'runner-retry',
    timeoutMs: 120000,
    onLocalSnapshotReady() {
      localReadyCount += 1;
    }
  });
  const signalLines = result.text.split(' · ').filter((line) => line.startsWith('SNAPSHOT='));
  if (localReadyCount !== 1) throw new Error(`lokale Freigaben: ${localReadyCount}`);
  if (!Array.isArray(result.diagnosticSnapshots) || result.diagnosticSnapshots.length !== 1) {
    throw new Error(`Diagnose-Snapshots: ${JSON.stringify(result.diagnosticSnapshots)}`);
  }
  if (signalLines.length !== 1) throw new Error(`finale SNAPSHOT-Signale: ${signalLines.length}`);
  if (!result.text.includes('KONSISTENZVERSUCH=2/2')) {
    throw new Error('Der zweite Konsistenzversuch fehlt.');
  }
  if (fs.readFileSync(path.join(result.snapshot, 'STATUS.txt'), 'utf8').trim() !== 'VOLLSTAENDIG') {
    throw new Error('Der finale Runner-Snapshot ist nicht vollständig.');
  }
  process.stdout.write('RUNNER_RETRY=OK\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE
)
RUNNER_RETRY_RC=$?
set -e
[[ $RUNNER_RETRY_RC -eq 0 && $RUNNER_RETRY_AUSGABE == *"RUNNER_RETRY=OK"* ]] ||
  scheitern "Der echte Runner hat den Konsistenz-Retry nicht korrekt beendet: $RUNNER_RETRY_AUSGABE"
[[ -f $RUNNER_RETRY_ONCE ]] ||
  scheitern "Die deterministische Datenbaum-Mutation wurde nicht ausgelöst."
rm -f -- "$DATA/retry-mutation.txt"

# Direkt vor dem atomaren mv wird der Zielpfad durch einen gleich markierten
# Symlink auf einen anderen Ordner ersetzt. Der Lauf muss den Pfadtausch trotz
# identischer TARGET_ID erkennen und darf nirgends einen finalen Snapshot zeigen.
SWAP_ZIEL=$TMP/snapshots-target-swap
SWAP_ALT=$TMP/snapshots-target-swap-alt
SWAP_ERSATZ=$TMP/snapshots-target-swap-ersatz
SWAP_BIN=$TMP/target-swap-bin
SWAP_ONCE=$TMP/target-swap-once
SWAP_TARGET_ID=33333333-3333-4333-8333-333333333333
SWAP_REAL_DATE=$(command -v date)
mkdir -p "$SWAP_ZIEL" "$SWAP_ERSATZ" "$SWAP_BIN"
for marker_ziel in "$SWAP_ZIEL" "$SWAP_ERSATZ"; do
  {
    printf 'Betreuungsbuero-Backupziel/1\n'
    printf 'TARGET_ID=%s\n' "$SWAP_TARGET_ID"
    printf 'CREATED_AT=2026-07-28T00:00:00Z\n'
  } > "$marker_ziel/.betreuungsbuero-backup-ziel"
done
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ ${1:-} == "+%Y%m%d_%H%M%S" && ! -e $SWAP_ONCE ]]; then' \
  '  mv -- "$SWAP_ZIEL" "$SWAP_ALT"' \
  '  ln -s -- "$SWAP_ERSATZ" "$SWAP_ZIEL"' \
  '  : > "$SWAP_ONCE"' \
  'fi' \
  'exec "$SWAP_REAL_DATE" "$@"' \
  > "$SWAP_BIN/date"
chmod 700 "$SWAP_BIN/date"
set +e
SWAP_AUSGABE=$( \
  PATH="$SWAP_BIN:$PATH" \
  SWAP_ONCE="$SWAP_ONCE" \
  SWAP_ZIEL="$SWAP_ZIEL" \
  SWAP_ALT="$SWAP_ALT" \
  SWAP_ERSATZ="$SWAP_ERSATZ" \
  SWAP_REAL_DATE="$SWAP_REAL_DATE" \
  bash "$BACKUP" \
  --db "$DB" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$SWAP_ZIEL" \
  --require-marker \
  --expected-target-id "$SWAP_TARGET_ID" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --app-file "$APP_FIXTURE" \
  --label target-swap 2>&1)
SWAP_RC=$?
set -e
[[ $SWAP_RC -ne 0 ]] ||
  scheitern "Ein unmittelbar vor der Veroeffentlichung getauschtes Ziel wurde akzeptiert."
[[ -f $SWAP_ONCE && -L $SWAP_ZIEL ]] ||
  scheitern "Der deterministische Zieltausch wurde nicht ausgeloest."
[[ $SWAP_AUSGABE == *"unmittelbar vor der Veroeffentlichung"* ||
   $SWAP_AUSGABE == *"waehrend des Laufs ausgetauscht"* ]] ||
  scheitern "Der Zieltausch wurde nicht verstaendlich gemeldet: $SWAP_AUSGABE"
SWAP_SIGNAL_COUNT=$(printf '%s\n' "$SWAP_AUSGABE" |
  awk '/^(SNAPSHOT|DIAGNOSE_SNAPSHOT)=/{n++} END{print n+0}')
[[ $SWAP_SIGNAL_COUNT -eq 0 ]] ||
  scheitern "Nach dem Zieltausch wurde trotzdem ein Snapshot-Signal ausgegeben."
[[ -z $(find "$SWAP_ERSATZ" "$SWAP_ALT" -mindepth 1 -maxdepth 1 \
  -type d -name 'Gesamtsicherung_*' -print) ]] ||
  scheitern "Nach dem Zieltausch wurde trotzdem ein finaler Snapshot veroeffentlicht."

# Alte, eindeutig eigene vollständige Fixture wird von der expliziten
# Generationenregel nur nach vollständiger Manifestprüfung entfernt; ein
# ähnlich benannter Fremdordner und eine beschädigte Generation bleiben stehen.
ALTE_GENERATION=$BACKUP_ZIEL/Gesamtsicherung_20200101_010101_fixture
mkdir -p "$ALTE_GENERATION/verwaltung"
printf 'VOLLSTAENDIG\n' > "$ALTE_GENERATION/STATUS.txt"
printf 'Betreuungsbuero-Gesamtsicherung/1\n' \
  > "$ALTE_GENERATION/verwaltung/SNAPSHOT-FORMAT.txt"
printf 'manual\n' > "$ALTE_GENERATION/verwaltung/JOB-ID.txt"
printf '%s\n' "$FIXTURE_TARGET_ID" > "$ALTE_GENERATION/verwaltung/TARGET-ID.txt"
{
  for MANIFEST_REL in \
    STATUS.txt \
    verwaltung/SNAPSHOT-FORMAT.txt \
    verwaltung/JOB-ID.txt \
    verwaltung/TARGET-ID.txt; do
    printf '%s\t%s\t%s\n' \
      "$(sha "$ALTE_GENERATION/$MANIFEST_REL")" \
      "$(groesse "$ALTE_GENERATION/$MANIFEST_REL")" \
      "$(printf '%s' "$MANIFEST_REL" | base64 | tr -d '\r\n')"
  done
} > "$ALTE_GENERATION/MANIFEST.tsv"
sha "$ALTE_GENERATION/MANIFEST.tsv" > "$ALTE_GENERATION/MANIFEST.tsv.sha256"
BESCHAEDIGTE_GENERATION=$BACKUP_ZIEL/Gesamtsicherung_20210101_010101_fixture
mkdir -p "$BESCHAEDIGTE_GENERATION/verwaltung"
printf 'VOLLSTAENDIG\n' > "$BESCHAEDIGTE_GENERATION/STATUS.txt"
printf 'absichtlich nicht validierbar\n' > "$BESCHAEDIGTE_GENERATION/MANIFEST.tsv"
printf 'Betreuungsbuero-Gesamtsicherung/1\n' \
  > "$BESCHAEDIGTE_GENERATION/verwaltung/SNAPSHOT-FORMAT.txt"
printf 'manual\n' > "$BESCHAEDIGTE_GENERATION/verwaltung/JOB-ID.txt"
printf '%s\n' "$FIXTURE_TARGET_ID" > "$BESCHAEDIGTE_GENERATION/verwaltung/TARGET-ID.txt"
mkdir -p "$BACKUP_ZIEL/Gesamtsicherung_fremd"

set +e
BACKUP_AUSGABE=$( \
  BETREUUNGSBUERO_BUILD_ID=fixture-build-2026.07 \
  PUBLIC_BASE_URL=https://akten.example.test \
  CALENDAR_SYNC_INTERVAL_SECONDS=123 \
  MAILBOX_WATCH=0 \
  REQUEST_TIMEOUT_MS=4567 \
  ENABLE_DOCUMENT_MIGRATION=1 \
  EXT_AI_PROVIDER=ollama \
  EXT_UPDATE_VERSION=9.9.9 \
  EXT_UPDATE_XPI_URL=https://download.example.test/addon.xpi \
  DOK_GRAPH_BASE=https://graph.example.test/v1.0 \
  DOK_MS_AUTH='https://login.example.test/authorize?client_id=nicht-protokollieren' \
  DOK_MS_TOKEN=https://login.example.test/token \
  DOK_GD_AUTH=https://accounts.example.test/auth \
  DOK_GD_TOKEN=https://oauth.example.test/token \
  DOK_GD_API=https://drive.example.test/v3 \
  DOK_GD_UPLOAD=https://upload.example.test/v3 \
  DATA_DIR=/srv/betreuungsbuero-data \
  TOTAL_BACKUP_RESTIC_ENV_FILE=/run/backup-secrets/restic-backend.env \
  bash "$BACKUP" \
  --db "$DB" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL" \
  --require-marker \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --retention-daily 1 \
  --label fixture 2>&1)
BACKUP_RC=$?
set -e
printf '%s\n' "$BACKUP_AUSGABE"
[[ $BACKUP_RC -eq 0 ]] || scheitern "Vollstaendiges Backup meldete Code $BACKUP_RC."

exec 9>&-
wait "$SQLITE_PID"
SQLITE_PID=

SNAPSHOT=$(printf '%s\n' "$BACKUP_AUSGABE" | sed -n 's/^SNAPSHOT=//p' | tail -n 1)
[[ -n $SNAPSHOT ]] || scheitern "Snapshot wurde nicht atomar veroeffentlicht."
[[ $(sqlite3 -batch -noheader "$SNAPSHOT/datenbank/betreuungsbuero.sqlite3" \
  "SELECT value FROM wal_probe;") == im-wal ]] ||
  scheitern "SQLite .backup hat den WAL-Datensatz nicht aufgenommen."
[[ ! -e $SNAPSHOT/datenbank/betreuungsbuero.sqlite3-wal &&
   ! -e $SNAPSHOT/datenbank/betreuungsbuero.sqlite3-shm ]] ||
  scheitern "Die eigenständige SQLite-Sicherung enthält unerwartete WAL/SHM-Sidecars."
[[ ! -e $SNAPSHOT/inhalt/server-data/betreuungsbuero.sqlite3 ]] ||
  scheitern "Live-DB wurde entgegen der Regel in den Dateibaum kopiert."
[[ ! -e $SNAPSHOT/inhalt/server-data/betreuungsbuero.sqlite3-wal ]] ||
  scheitern "Live-WAL wurde entgegen der Regel in den Dateibaum kopiert."
[[ ! -e $SNAPSHOT/inhalt/server-data/.runtime-secrets ]] ||
  scheitern "Das getrennte Laufzeit-Secret-Verzeichnis wurde in den Datenbaum kopiert."
if grep -R -a -F -q "$RUNTIME_SECRET_SENTINEL" "$SNAPSHOT"; then
  scheitern "Der Wiederherstellungsschlüssel ist im Sicherungssnapshot enthalten."
fi
erwarte_datei "$SNAPSHOT/inhalt/server-data/custom-hidden/payload.bin"

# storageRoot ist die neue primaere Klarname-Wurzel; baseDir/caseDirs bleiben
# Legacy-Leseorte. Alle drei Zuordnungen muessen im Snapshot stehen, die unter
# baseDir liegende caseDir darf aber keine dritte physische Kopie erzeugen.
WURZEL_MAP=$SNAPSHOT/verwaltung/WURZELN.map
WURZEL_TSV=$SNAPSHOT/verwaltung/WURZELN.tsv
grep -q '^STORAGE|' "$WURZEL_MAP" || scheitern "storageRoot fehlt in WURZELN.map."
grep -q '^BASE|' "$WURZEL_MAP" || scheitern "baseDir fehlt in WURZELN.map."
grep -q '^CASE|' "$WURZEL_MAP" || scheitern "caseDirs fehlt in WURZELN.map."
grep -q $'^STORAGE\t' "$WURZEL_TSV" || scheitern "storageRoot fehlt in WURZELN.tsv."
EXTERNE_KOPIEN=$(find "$SNAPSHOT/inhalt/externe-dokumentwurzeln" \
  -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
[[ $EXTERNE_KOPIEN -eq 2 ]] ||
  scheitern "storageRoot + baseDir mit enthaltener caseDir haetten genau 2 externe Kopien ergeben muessen (waren $EXTERNE_KOPIEN)."
STORAGE_ZIEL_HEX=$(awk -F'|' '$1=="STORAGE"{print $4;exit}' "$WURZEL_MAP")
BASE_ZIEL_HEX=$(awk -F'|' '$1=="BASE"{print $4;exit}' "$WURZEL_MAP")
CASE_ZIEL_HEX=$(awk -F'|' '$1=="CASE"{print $4;exit}' "$WURZEL_MAP")
[[ -n $STORAGE_ZIEL_HEX && -n $BASE_ZIEL_HEX && -n $CASE_ZIEL_HEX ]] ||
  scheitern "Eine Wurzelzuordnung hat kein Snapshotziel."
[[ $STORAGE_ZIEL_HEX != "$BASE_ZIEL_HEX" ]] ||
  scheitern "Getrennte storageRoot/baseDir wurden faelschlich zusammengelegt."
[[ $CASE_ZIEL_HEX == "$BASE_ZIEL_HEX"* ]] ||
  scheitern "caseDir unter baseDir wurde nicht auf die vorhandene Kopie dedupliziert."
CENTRAL_SNAPSHOT_COUNT=$(find "$SNAPSHOT/inhalt/externe-dokumentwurzeln" \
  -type f -name '260701 * Eingang.txt' | wc -l | tr -d ' ')
[[ $CENTRAL_SNAPSHOT_COUNT -eq 1 ]] ||
  scheitern "Datei aus storageRoot wurde nicht genau einmal gesichert (Treffer: $CENTRAL_SNAPSHOT_COUNT)."

erwarte_datei "$SNAPSHOT/MANIFEST.tsv"
erwarte_datei "$SNAPSHOT/MANIFEST.tsv.sha256"
erwarte_datei "$SNAPSHOT/NOTFALL-RETTUNG.sh"
erwarte_datei "$SNAPSHOT/ANLEITUNG.txt"
erwarte_datei "$SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt"
erwarte_datei "$SNAPSHOT/betrieb/server-quellcode.tar.gz"
erwarte_datei "$SNAPSHOT/betrieb/anwendung/Betreuungsbuero_Dokumentenassistent_v999_99.html"
erwarte_datei "$SNAPSHOT/betrieb/browser-erweiterungen/firefox__test.xpi"
erwarte_inhalt "$SNAPSHOT/betrieb/browser-erweiterungen/firefox__test.xpi" 'SIGNIERTES-XPI'
for KONFIG_NAME in \
  package.json package-lock.json Dockerfile docker-compose.yml .dockerignore .env.example; do
  erwarte_datei "$SNAPSHOT/betrieb/konfiguration/$KONFIG_NAME"
done
erwarte_datei "$SNAPSHOT/betrieb/server-ressourcen/templates/Stammdaten_blank.xlsx"
grep -Eq '^\.dockerignore-SHA-256: [0-9a-fA-F]{64}$' \
  "$SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt" ||
  scheitern "SHA-256 der verpflichtenden .dockerignore fehlt im Betriebsinventar."
QUELLARCHIV=$SNAPSHOT/betrieb/server-quellcode.tar.gz
QUELLARCHIV_LISTE=$TMP/server-quellcode-liste.txt
tar -tzf "$QUELLARCHIV" > "$QUELLARCHIV_LISTE"
for QUELL_REL in \
  index.js src/database/index.js src/modules/fixture/routes.js \
  src/config/paths.js src/security/secure-json.js src/modules/recovery/key-store.js \
  tools/fixture.sh tools/fixture.js tools/scheduler/fixture.example \
  docs/FIXTURE.txt assets/ocr/worker.min.js \
  assets/ocr/core/runtime.wasm.js assets/ocr/lang/deu.traineddata.gz; do
  grep -Fxq "$QUELL_REL" "$QUELLARCHIV_LISTE" ||
    scheitern "Freigegebene Serverquelle fehlt im Quellarchiv: $QUELL_REL"
done
if grep -Eq '(^|/)(data|node_modules|_backups|\.runtime-secrets)(/|$)|(^|/)\.env$|\.sqlite3(-wal|-shm)?$|\.log$|(^|/)restic-password$' \
  "$QUELLARCHIV_LISTE"; then
  scheitern "Das Quellarchiv enthaelt eine Daten-, Geheimnis-, Log- oder Abhaengigkeitsdatei."
fi
QUELLARCHIV_AUSGEPACKT=$TMP/server-quellcode-ausgepackt
mkdir -p "$QUELLARCHIV_AUSGEPACKT"
tar -xzf "$QUELLARCHIV" -C "$QUELLARCHIV_AUSGEPACKT"
erwarte_inhalt "$QUELLARCHIV_AUSGEPACKT/index.js" 'module.exports = "INDEX-FIXTURE";'
erwarte_inhalt "$QUELLARCHIV_AUSGEPACKT/assets/ocr/lang/deu.traineddata.gz" 'OCR-SPRACHE-FIXTURE'
grep -Fxq 'Build-ID: fixture-build-2026.07' "$SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt" ||
  scheitern "Explizite Build-ID fehlt im Betriebsinventar."
grep -Eq '^Server-Quellarchiv-SHA-256: [0-9a-fA-F]{64}$' \
  "$SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt" ||
  scheitern "SHA-256 des Server-Quellarchivs fehlt im Betriebsinventar."
grep -Eq '^Server-Quellarchiv-Bytes: [1-9][0-9]*$' \
  "$SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt" ||
  scheitern "Bytegroesse des Server-Quellarchivs fehlt im Betriebsinventar."
for KONFIG_ZEILE in \
  'PUBLIC_BASE_URL: https://akten.example.test' \
  'CALENDAR_SYNC_INTERVAL_SECONDS: 123' \
  'MAILBOX_WATCH: 0' \
  'REQUEST_TIMEOUT_MS: 4567' \
  'ENABLE_DOCUMENT_MIGRATION: 1' \
  'EXT_AI_PROVIDER: ollama' \
  'EXT_UPDATE_VERSION: 9.9.9' \
  'EXT_UPDATE_XPI_URL: https://download.example.test/addon.xpi' \
  'DOK_GRAPH_BASE: https://graph.example.test/v1.0' \
  'DOK_MS_AUTH: gesetzt, aber wegen möglicher Zugangsdaten nicht im Klartext protokolliert' \
  'DOK_MS_TOKEN: https://login.example.test/token' \
  'DOK_GD_AUTH: https://accounts.example.test/auth' \
  'DOK_GD_TOKEN: https://oauth.example.test/token' \
  'DOK_GD_API: https://drive.example.test/v3' \
  'DOK_GD_UPLOAD: https://upload.example.test/v3' \
  'DATA_DIR: /srv/betreuungsbuero-data' \
  'TOTAL_BACKUP_RESTIC_ENV_FILE: /run/backup-secrets/restic-backend.env'; do
  grep -Fxq "$KONFIG_ZEILE" "$SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt" ||
    scheitern "Aktive Laufzeitkonfiguration fehlt im Betriebsinventar: $KONFIG_ZEILE"
done
if grep -Fq 'nicht-protokollieren' "$SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt"; then
  scheitern "Ein URL-Abfrageparameter wurde im Betriebsinventar im Klartext protokolliert."
fi
[[ ! -e $ALTE_GENERATION ]] ||
  scheitern "Explizite Retention hat die alte eigene Generation nicht entfernt."
[[ -d $BESCHAEDIGTE_GENERATION &&
   $BACKUP_AUSGABE == *"WARNUNG=RETENTION_SNAPSHOT_UNGEPRUEFT"* ]] ||
  scheitern "Retention hat eine beschädigte Generation nicht sichtbar geschützt."
[[ -d $BACKUP_ZIEL/Gesamtsicherung_fremd ]] ||
  scheitern "Retention hat einen nicht eindeutig eigenen Ordner entfernt."
grep -q 'Retention geloescht: Gesamtsicherung_20200101_010101_fixture' \
  "$BACKUP_ZIEL/backup-maintenance.log" ||
  scheitern "Kontrollierte Entfernung fehlt im Wartungsprotokoll."
grep -qx VOLLSTAENDIG "$SNAPSHOT/STATUS.txt" ||
  scheitern "Snapshot ist unerwartet unvollstaendig."
grep -q "security-encrypted.*authentifiziert entschluesselt" "$SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Sicherheitsabbild wurde trotz vorhandenem Recovery-Key nicht kryptografisch geprueft."
grep -q "credentials-encrypted.*authentifiziert entschluesselt" "$SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Zugangsdatenabbild wurde trotz vorhandenem Recovery-Key nicht kryptografisch geprueft."

# Ein SIGKILL nach Anlage der großen Arbeitsstufe darf nicht bei jedem
# Folgelauf eine weitere unsichtbare Vollkopie hinterlassen. Die vor dem
# Stage-Verzeichnis veröffentlichte Owner-Datei macht nur eigene Reste
# kontrolliert entfernbar; ein ähnlich benannter fremder Ordner bleibt stehen.
REAL_SQLITE=$(command -v sqlite3)
STAGE_BIN=$TMP/stage-fake-bin
STAGE_SQLITE_MARKER=$TMP/stage-sqlite-started
STAGE_SQLITE_PID_FILE=$TMP/stage-sqlite.pid
mkdir -p "$STAGE_BIN" "$BACKUP_ZIEL_STAGE"
printf '%s\n' \
  '#!/bin/sh' \
  'if [ ! -e "$STAGE_SQLITE_MARKER" ]; then' \
  '  : > "$STAGE_SQLITE_MARKER"' \
  '  printf "%s\\n" "$$" > "$STAGE_SQLITE_PID_FILE"' \
  '  exec sleep 120' \
  'fi' \
  'exec "$REAL_SQLITE" "$@"' \
  > "$STAGE_BIN/sqlite3"
chmod 700 "$STAGE_BIN/sqlite3"
PATH="$STAGE_BIN:$PATH" STAGE_SQLITE_MARKER="$STAGE_SQLITE_MARKER" \
  STAGE_SQLITE_PID_FILE="$STAGE_SQLITE_PID_FILE" REAL_SQLITE="$REAL_SQLITE" \
  bash "$BACKUP" \
    --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
    --destination "$BACKUP_ZIEL_STAGE" --expected-recovery-fingerprint "$RECOVERY_FP" \
    --label stage-sigkill > "$TMP/stage-sigkill.log" 2>&1 &
STAGE_BACKUP_PID=$!
STAGE_READY=nein
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  STAGE_OWNER_GEFUNDEN=$(find "$BACKUP_ZIEL_STAGE" -mindepth 1 -maxdepth 1 \
    -type f -name '.gesamt-backup-stage-*.owner' -print | sed -n '1p')
  if [[ -s $STAGE_SQLITE_PID_FILE && -n $STAGE_OWNER_GEFUNDEN &&
        -d ${STAGE_OWNER_GEFUNDEN%.owner} ]]; then
    STAGE_READY=ja
    break
  fi
  sleep 0.1
done
[[ $STAGE_READY == ja ]] || scheitern "SIGKILL-Stage-Fixture wurde nicht bereit."
STAGE_SQLITE_PID=$(<"$STAGE_SQLITE_PID_FILE")
VERWAISTE_STAGE=${STAGE_OWNER_GEFUNDEN%.owner}
kill -9 "$STAGE_BACKUP_PID" "$STAGE_SQLITE_PID" 2>/dev/null || true
set +e
wait "$STAGE_BACKUP_PID" 2>/dev/null
set -e
STAGE_BACKUP_PID=
STAGE_SQLITE_PID=
[[ -d $VERWAISTE_STAGE && -f ${VERWAISTE_STAGE}.owner ]] ||
  scheitern "SIGKILL hat keine sichtbar markierte verwaiste Arbeitsstufe hinterlassen."

FREMDE_STAGE=$BACKUP_ZIEL_STAGE/.gesamt-backup-stage-999-999-999-999
mkdir -p "$FREMDE_STAGE"
LEGACY_STAGE=$BACKUP_ZIEL_STAGE/.gesamt-backup.A1B2C3D4
FREMDE_LEGACY_STAGE=$BACKUP_ZIEL_STAGE/.gesamt-backup.Z9Y8X7W6
mkdir -p "$LEGACY_STAGE/verwaltung" "$FREMDE_LEGACY_STAGE"
printf 'Betreuungsbuero-Gesamtsicherung/1\n' \
  > "$LEGACY_STAGE/verwaltung/SNAPSHOT-FORMAT.txt"
set +e
STAGE_FOLGE_AUSGABE=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_STAGE" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label stage-folgelauf 2>&1)
STAGE_FOLGE_RC=$?
set -e
[[ $STAGE_FOLGE_RC -eq 0 && $STAGE_FOLGE_AUSGABE == *"STAGE_BEREINIGUNG=OK"* ]] ||
  scheitern "Folgelauf hat die eigene verwaiste Arbeitsstufe nicht kontrolliert bereinigt."
[[ ! -e $VERWAISTE_STAGE && ! -e ${VERWAISTE_STAGE}.owner ]] ||
  scheitern "Eigene verwaiste Arbeitsstufe blieb nach dem Folgelauf erhalten."
[[ ! -e $LEGACY_STAGE ]] ||
  scheitern "Eigene markierte Legacy-Arbeitsstufe blieb nach dem Folgelauf erhalten."
[[ -d $FREMDE_STAGE && -d $FREMDE_LEGACY_STAGE ]] ||
  scheitern "Stage-Bereinigung hat einen ähnlich benannten fremden Ordner entfernt."

# Eine lebende Sperre darf niemals übernommen werden. Nach SIGKILL des
# Besitzerprozesses bleibt dessen Lock absichtlich ohne Trap-Cleanup liegen;
# der nächste Lauf muss ihn anhand PID + Startkennung sicher zurückfordern.
REAL_SQLITE=$(command -v sqlite3)
LOCK_BIN=$TMP/lock-fake-bin
LOCK_MARKER=$TMP/lock-sqlite-started
LOCK_WRAPPER_FILE=$TMP/lock-wrapper.pid
LOCK_CHILD_FILE=$TMP/lock-child.pid
mkdir -p "$LOCK_BIN" "$BACKUP_ZIEL_LOCK"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ ! -e $LOCK_MARKER ]]; then' \
  '  : > "$LOCK_MARKER"' \
  '  printf "%s\\n" "$$" > "$LOCK_WRAPPER_FILE"' \
  '  sleep 120 &' \
  '  child=$!' \
  '  printf "%s\\n" "$child" > "$LOCK_CHILD_FILE"' \
  '  wait "$child"' \
  'fi' \
  'exec "$REAL_SQLITE" "$@"' \
  > "$LOCK_BIN/sqlite3"
chmod 700 "$LOCK_BIN/sqlite3"
PATH="$LOCK_BIN:$PATH" LOCK_MARKER="$LOCK_MARKER" \
  LOCK_WRAPPER_FILE="$LOCK_WRAPPER_FILE" LOCK_CHILD_FILE="$LOCK_CHILD_FILE" \
  REAL_SQLITE="$REAL_SQLITE" bash "$BACKUP" \
    --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
    --destination "$BACKUP_ZIEL_LOCK" --expected-recovery-fingerprint "$RECOVERY_FP" \
    --label lock-owner > "$TMP/lock-owner.log" 2>&1 &
LOCK_BACKUP_PID=$!
LOCK_READY=nein
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if [[ -s $BACKUP_ZIEL_LOCK/.gesamt-backup.lock/token &&
        -s $LOCK_WRAPPER_FILE && -s $LOCK_CHILD_FILE ]]; then
    LOCK_READY=ja
    break
  fi
  sleep 0.1
done
[[ $LOCK_READY == ja ]] || scheitern "Lebende Lock-Fixture wurde nicht bereit."
LOCK_WRAPPER_PID=$(<"$LOCK_WRAPPER_FILE")
LOCK_CHILD_PID=$(<"$LOCK_CHILD_FILE")

set +e
LOCK_LIVE_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_LOCK" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label lock-muss-scheitern 2>&1)
LOCK_LIVE_RC=$?
set -e
[[ $LOCK_LIVE_RC -eq 64 && $LOCK_LIVE_OUTPUT == *"Es laeuft bereits eine Sicherung"* ]] ||
  scheitern "Eine lebende Backup-Sperre wurde nicht zuverlässig respektiert."

kill -9 "$LOCK_BACKUP_PID"
set +e
wait "$LOCK_BACKUP_PID" 2>/dev/null
set -e
LOCK_BACKUP_PID=
[[ -d $BACKUP_ZIEL_LOCK/.gesamt-backup.lock ]] ||
  scheitern "SIGKILL-Fixture hat die veraltete Sperre unerwartet aufgeraeumt."

set +e
LOCK_RECLAIM_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_LOCK" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label lock-reclaimed 2>&1)
LOCK_RECLAIM_RC=$?
set -e
[[ $LOCK_RECLAIM_RC -eq 0 ]] ||
  scheitern "Tote SIGKILL-Sperre wurde nicht zurückgefordert (Code $LOCK_RECLAIM_RC)."
[[ ! -e $BACKUP_ZIEL_LOCK/.gesamt-backup.lock ]] ||
  scheitern "Eigene Sperre wurde nach erfolgreichem Folgelauf nicht entfernt."
kill -9 "$LOCK_WRAPPER_PID" "$LOCK_CHILD_PID" 2>/dev/null || true
LOCK_WRAPPER_PID=
LOCK_CHILD_PID=

# Exakter Zustand nach SIGKILL während der Reclaim-Phase: Hauptbesitzer und
# `.reclaim` sind beide tot. Ein lebender Reclaimer wird zunächst konservativ
# respektiert; danach muss derselbe verwaiste Zustand automatisch heilbar sein.
mkdir -p "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim"
printf '99999999\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/pid"
printf 'Mon Jan  1 00:00:00 2001\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/start"
printf 'alter-haupt-lock\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/token"
printf '%s\n' "$$" > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim/pid"
ps -p "$$" -o lstart= | awk '{$1=$1; print}' \
  > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim/start"
printf 'lebender-reclaimer\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim/token"
set +e
RECLAIM_LIVE_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_LOCK" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label reclaim-lebt 2>&1)
RECLAIM_LIVE_RC=$?
set -e
[[ $RECLAIM_LIVE_RC -eq 64 && $RECLAIM_LIVE_OUTPUT == *"Sperrpruefung"* ]] ||
  scheitern "Eine lebende Reclaim-Sperre wurde nicht respektiert."

printf '99999998\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim/pid"
printf 'Mon Jan  1 00:00:00 2001\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim/start"
printf 'toter-reclaimer\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim/token"
set +e
RECLAIM_STALE_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_LOCK" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label reclaim-stale 2>&1)
RECLAIM_STALE_RC=$?
set -e
[[ $RECLAIM_STALE_RC -eq 0 ]] ||
  scheitern "Nach SIGKILL verwaiste Reclaim-Sperre blieb dauerhaft blockierend."
[[ ! -e $BACKUP_ZIEL_LOCK/.gesamt-backup.lock ]] ||
  scheitern "Reclaim-Folgelauf hat seine eigene Sperre nicht entfernt."

# Kritischer Kombinationsfall: Der Haupt-Owner lebt, nur sein Reclaimer starb.
# Der tote Unterlock darf entfernt, die aktive Hauptsicherung aber niemals
# umbenannt oder übernommen werden.
mkdir -p "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim"
printf '%s\n' "$$" > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/pid"
ps -p "$$" -o lstart= | awk '{$1=$1; print}' \
  > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/start"
printf 'lebender-haupt-owner\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/token"
printf '99999997\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim/pid"
printf 'Mon Jan  1 00:00:00 2001\n' > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim/start"
printf 'toter-reclaimer-bei-lebendem-owner\n' \
  > "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim/token"
set +e
MAIN_LIVE_RECLAIM_DEAD_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_LOCK" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label owner-lebt-reclaimer-tot 2>&1)
MAIN_LIVE_RECLAIM_DEAD_RC=$?
set -e
[[ $MAIN_LIVE_RECLAIM_DEAD_RC -eq 64 &&
   $MAIN_LIVE_RECLAIM_DEAD_OUTPUT == *"nur ihr verwaister Reclaim wurde entfernt"* ]] ||
  scheitern "Toter Reclaimer führte zur Übernahme eines lebenden Haupt-Owners."
[[ $(<"$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/token") == lebender-haupt-owner ]] ||
  scheitern "Lebende Hauptsperre wurde im kombinierten Race verändert."
[[ ! -e $BACKUP_ZIEL_LOCK/.gesamt-backup.lock/.reclaim ]] ||
  scheitern "Toter Reclaim-Unterlock wurde beim lebenden Haupt-Owner nicht entfernt."
rm -f -- "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/pid" \
  "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/start" \
  "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock/token"
rmdir -- "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock"

# Ein gerade erst angelegter, noch unvollständiger Owner wird nicht als tot
# fehlgedeutet. Nach Ablauf des Mindestalters bleibt derselbe Crashzustand
# automatisch heilbar.
mkdir "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock"
set +e
LOCK_PARTIAL_YOUNG_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_LOCK" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label partial-jung 2>&1)
LOCK_PARTIAL_YOUNG_RC=$?
set -e
[[ $LOCK_PARTIAL_YOUNG_RC -eq 64 &&
   $LOCK_PARTIAL_YOUNG_OUTPUT == *"initialisiert gerade ihre Sperre"* ]] ||
  scheitern "Frische partielle Owner-Metadaten wurden nicht konservativ geschützt."
touch -t 200101010000 "$BACKUP_ZIEL_LOCK/.gesamt-backup.lock"
set +e
LOCK_PARTIAL_ALT_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_LOCK" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label partial-alt 2>&1)
LOCK_PARTIAL_ALT_RC=$?
set -e
[[ $LOCK_PARTIAL_ALT_RC -eq 0 ]] ||
  scheitern "Alte partielle SIGKILL-Sperre blieb trotz Mindestalter dauerhaft blockierend."

# Struktur und Authentizität werden unabhängig von DB-Dateihashes geprüft.
# Für jeden Fehlerfall wird nur die isolierte Fixture kurz geändert und danach
# bytegenau zurückgesetzt.
mkdir -p "$BACKUP_ZIEL_ENVELOPE"
CREDENTIALS_ORIGINAL=$TMP/credentials-original.enc
cp -p -- "$CREDENTIALS_IMAGE" "$CREDENTIALS_ORIGINAL"
aktualisiere_credentials_metadaten() {
  local sha_neu size_neu
  sha_neu=$(sha "$CREDENTIALS_IMAGE")
  size_neu=$(groesse "$CREDENTIALS_IMAGE")
  sqlite3 "$DB" "
    UPDATE doc_files SET sha256='$sha_neu',size=$size_neu WHERE id='credentials-image';
    UPDATE doc_materializations SET sha256='$sha_neu'
      WHERE scope_type='office' AND scope_id='' AND artifact_kind='credentials-encrypted';"
}
restauriere_credentials() {
  cp -p -- "$CREDENTIALS_ORIGINAL" "$CREDENTIALS_IMAGE"
  aktualisiere_credentials_metadaten
}

ENVELOPE_FILE="$CREDENTIALS_IMAGE" node <<'NODE'
const fs = require('fs');
const file = process.env.ENVELOPE_FILE;
const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
delete envelope.tag;
fs.writeFileSync(file, JSON.stringify(envelope) + '\n');
NODE
aktualisiere_credentials_metadaten
set +e
ENVELOPE_UNVOLL_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_ENVELOPE" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label envelope-unvollstaendig 2>&1)
ENVELOPE_UNVOLL_RC=$?
set -e
[[ $ENVELOPE_UNVOLL_RC -eq 2 ]] ||
  scheitern "Unvollständiger Recovery-Umschlag haette Code 2 liefern muessen."
ENVELOPE_UNVOLL_SNAPSHOT=$(find "$BACKUP_ZIEL_ENVELOPE" -type d \
  -name '*envelope-unvollstaendig_UNVOLLSTAENDIG*' -print | sed -n '1p')
grep -q "tag fehlt" "$ENVELOPE_UNVOLL_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Fehlender GCM-Tag wurde nicht strukturell ausgewiesen."
restauriere_credentials

ENVELOPE_FILE="$CREDENTIALS_IMAGE" node <<'NODE'
const fs = require('fs');
const file = process.env.ENVELOPE_FILE;
const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
const bytes = Buffer.from(envelope.ciphertext, 'base64');
bytes[0] ^= 1;
envelope.ciphertext = bytes.toString('base64');
fs.writeFileSync(file, JSON.stringify(envelope) + '\n');
NODE
aktualisiere_credentials_metadaten
set +e
ENVELOPE_MANIP_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_ENVELOPE" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label envelope-manipuliert 2>&1)
ENVELOPE_MANIP_RC=$?
set -e
[[ $ENVELOPE_MANIP_RC -eq 2 ]] ||
  scheitern "Manipulierter Recovery-Umschlag haette Code 2 liefern muessen."
ENVELOPE_MANIP_SNAPSHOT=$(find "$BACKUP_ZIEL_ENVELOPE" -type d \
  -name '*envelope-manipuliert_UNVOLLSTAENDIG*' -print | sed -n '1p')
grep -Eq "authenticat|entschluessel|unable to authenticate" \
  "$ENVELOPE_MANIP_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "GCM-Manipulation wurde nicht durch echte Entschlüsselung erkannt."
restauriere_credentials

ENVELOPE_FILE="$CREDENTIALS_IMAGE" node <<'NODE'
const fs = require('fs');
const file = process.env.ENVELOPE_FILE;
const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
envelope.keyFingerprint = '000000000000000000000000';
fs.writeFileSync(file, JSON.stringify(envelope) + '\n');
NODE
aktualisiere_credentials_metadaten
set +e
ENVELOPE_FP_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_ENVELOPE" --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label envelope-fingerprint-falsch 2>&1)
ENVELOPE_FP_RC=$?
set -e
[[ $ENVELOPE_FP_RC -eq 2 ]] ||
  scheitern "Falscher Fingerabdruck im Recovery-Umschlag haette Code 2 liefern muessen."
ENVELOPE_FP_SNAPSHOT=$(find "$BACKUP_ZIEL_ENVELOPE" -type d \
  -name '*envelope-fingerprint-falsch_UNVOLLSTAENDIG*' -print | sed -n '1p')
grep -Eq "passt nicht zu dieser Sicherung|Fingerabdruck" \
  "$ENVELOPE_FP_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Falscher Umschlag-Fingerabdruck wurde nicht erkannt."
restauriere_credentials

FALSCHER_FP=000000000000000000000000
[[ $FALSCHER_FP != "$RECOVERY_FP" ]] ||
  FALSCHER_FP=ffffffffffffffffffffffff
set +e
FINGERPRINT_OUTPUT=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_ENVELOPE" --expected-recovery-fingerprint "$FALSCHER_FP" \
  --label fingerprint-erwartet-falsch 2>&1)
FINGERPRINT_RC=$?
set -e
[[ $FINGERPRINT_RC -eq 2 ]] ||
  scheitern "Falscher erwarteter Recovery-Fingerabdruck haette Code 2 liefern muessen."
FINGERPRINT_SNAPSHOT=$(find "$BACKUP_ZIEL_ENVELOPE" -type d \
  -name '*fingerprint-erwartet-falsch_UNVOLLSTAENDIG*' -print | sed -n '1p')
grep -q "erwarteter Fingerabdruck widersprechen" "$FINGERPRINT_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Widerspruch zwischen aktivem Key und erwartetem Fingerabdruck fehlt im Bericht."

set +e
KEIN_KEY_OUTPUT=$(DOCUMENT_RECOVERY_KEY_FILE="$TMP/kein-recovery-key" DOCUMENT_RECOVERY_KEY= \
  bash "$BACKUP" \
    --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
    --destination "$BACKUP_ZIEL_ENVELOPE" --expected-recovery-fingerprint "$RECOVERY_FP" \
    --label recovery-key-fehlt 2>&1)
KEIN_KEY_RC=$?
set -e
[[ $KEIN_KEY_RC -eq 2 ]] ||
  scheitern "Regulärer Lauf ohne Recovery-Key muss fail-closed unvollständig sein."
KEIN_KEY_SNAPSHOT=$(find "$BACKUP_ZIEL_ENVELOPE" -type d \
  -name '*recovery-key-fehlt_UNVOLLSTAENDIG*' -print | sed -n '1p')
grep -q "kryptografisch ungeprueft" "$KEIN_KEY_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "Fehlender Recovery-Key wurde nicht als kryptografisch ungeprüft ausgewiesen."

# Regression: Ein vorhandenes doc_versions mit unerwartetem Schema darf nicht
# durch die frühere Process-Substitution wie eine leere Tabelle wirken. Die
# produktive Fixture bleibt unangetastet; nur eine SQLite-eigene Kopie wird
# absichtlich inkompatibel gemacht.
DB_SQL_FEHLER=$TMP/schemafehler.sqlite3
sqlite3 -batch "$DB" ".backup '$DB_SQL_FEHLER'"
sqlite3 "$DB_SQL_FEHLER" <<'SQL'
DROP TABLE doc_versions;
CREATE TABLE doc_versions(id TEXT PRIMARY KEY, file_id TEXT NOT NULL);
INSERT INTO doc_versions(id,file_id) VALUES('nicht-still-auslassen','case-file');
SQL
mkdir -p "$BACKUP_ZIEL_SQL_FEHLER"
set +e
SQL_FEHLER_AUSGABE=$(bash "$BACKUP" \
  --db "$DB_SQL_FEHLER" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_SQL_FEHLER" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label sql-schemafehler 2>&1)
SQL_FEHLER_RC=$?
set -e
[[ $SQL_FEHLER_RC -eq 2 ]] ||
  scheitern "Fehlgeschlagene doc_versions-Abfrage haette Code 2 liefern muessen (war $SQL_FEHLER_RC)."
SQL_FEHLER_SNAPSHOT=$(find "$BACKUP_ZIEL_SQL_FEHLER" -mindepth 1 -maxdepth 1 \
  -type d -name '*_UNVOLLSTAENDIG*' -print | sed -n '1p')
[[ -n $SQL_FEHLER_SNAPSHOT ]] ||
  scheitern "SQL-Schemafehler hat keinen sichtbar unvollstaendigen Snapshot erzeugt."
grep -q "SQLite-Pruefabfrage 'doc_versions' ist fehlgeschlagen" \
  "$SQL_FEHLER_SNAPSHOT/PRUEFBERICHT.txt" ||
  scheitern "doc_versions-Schemafehler wurde im Pruefbericht nicht ausgewiesen."

set +e
RETTUNG_AUSGABE=$(bash "$RETTUNG" --snapshot "$SNAPSHOT" --output "$RETTUNG_ZIEL" 2>&1)
RETTUNG_RC=$?
set -e
printf '%s\n' "$RETTUNG_AUSGABE"
[[ $RETTUNG_RC -eq 0 ]] || scheitern "Rettung meldete Code $RETTUNG_RC."

CASE_CLEAR=$(finde_eine_datei "$RETTUNG_ZIEL" '260615 Ärger, Anna Beschluss.pdf')
erwarte_inhalt "$CASE_CLEAR" 'Fallakte extern'
[[ $CASE_CLEAR == */Fallakten/A/* ]] ||
  scheitern "Die physische Buchstabenebene A wurde nicht rekonstruiert."
OFFICE_CLEAR=$(finde_eine_datei "$RETTUNG_ZIEL" 'Büroplan.pdf')
erwarte_inhalt "$OFFICE_CLEAR" 'Buero extern'
VERSION_CLEAR=$(finde_eine_datei "$RETTUNG_ZIEL" '260501 Ärger, Anna Beschluss.pdf')
erwarte_inhalt "$VERSION_CLEAR" 'Vorherige Version'
TRUE_CLEAR=$(finde_eine_datei "$RETTUNG_ZIEL" '260701 Ärger, Anna Eingang.txt')
erwarte_inhalt "$TRUE_CLEAR" 'Echter Klarname auf Platte'
INBOX_CLEAR=$(finde_eine_datei "$RETTUNG_ZIEL" '260617 Eingangsschreiben.pdf')
erwarte_inhalt "$INBOX_CLEAR" 'Posteingang'
ORPHAN_CLEAR=$(finde_eine_datei "$RETTUNG_ZIEL/_Ohne_Zuordnung" 'orphan-uuid')
erwarte_inhalt "$ORPHAN_CLEAR" 'Waise ohne DB-Zeile'
FUTURE_CLEAR=$(finde_eine_datei "$RETTUNG_ZIEL/_Ohne_Zuordnung" 'payload.bin')
erwarte_inhalt "$FUTURE_CLEAR" 'Kuenftiges Modul'
PHOTO_COUNT=$(find "$RETTUNG_ZIEL/Fallakten" -type f -name 'Besuchsfoto.jpg' | wc -l | tr -d ' ')
[[ $PHOTO_COUNT -eq 1 ]] ||
  scheitern "Geteilte Fotokennung wurde nicht als genau ein zentraler Dateiinhalt gerettet."
find "$RETTUNG_ZIEL/Fallakten" -type f -path '*/2026/06/*/Besuchsfoto.jpg' | grep -q . ||
  scheitern "TT.MM.JJJJ-Ereignisdatum wurde nicht nach Jahr/Monat normalisiert."
grep -qx VOLLSTAENDIG "$RETTUNG_ZIEL/STATUS.txt" ||
  scheitern "Rettung ist unerwartet unvollstaendig."

# Echte Offsite-Semantik ohne Netzwerk: Ein isoliertes restic-Doppel bestätigt,
# dass nur ein Remoteprofil akzeptiert, dessen Rückgabecode fail-closed
# ausgewertet und niemals die Passwortdatei in den Snapshot kopiert wird.
FAKE_BIN=$TMP/fake-bin
FAKE_RESTIC_ARGS=$TMP/fake-restic.args
FAKE_RESTIC_LOG=$TMP/fake-restic.log
FAKE_RESTIC_RC_FILE=$TMP/fake-restic.rc
OFFSITE_PASSWORD=$TMP/restic-password
mkdir -p "$FAKE_BIN" "$BACKUP_ZIEL_OFFSITE"
printf '0\n' > "$FAKE_RESTIC_RC_FILE"
printf '%s\n' \
  '#!/bin/sh' \
  "FAKE_RESTIC_ARGS=$FAKE_RESTIC_ARGS" \
  "FAKE_RESTIC_LOG=$FAKE_RESTIC_LOG" \
  "FAKE_RESTIC_RC_FILE=$FAKE_RESTIC_RC_FILE" \
  'forbidden=' \
  '[ -z "${SESSION_SECRET+x}" ] || forbidden=SESSION_SECRET' \
  '[ -z "${ENCRYPTION_KEY+x}" ] || forbidden=ENCRYPTION_KEY' \
  '[ -z "${DOCUMENT_RECOVERY_KEY+x}" ] || forbidden=DOCUMENT_RECOVERY_KEY' \
  '[ -z "${SETUP_TOKEN+x}" ] || forbidden=SETUP_TOKEN' \
  '[ -z "$forbidden" ] || { printf "LEAK:%s\n" "$forbidden" >> "$FAKE_RESTIC_LOG"; exit 95; }' \
  '[ -n "${PATH:-}" ] || exit 94' \
  'printf "%s\n" "$@" > "$FAKE_RESTIC_ARGS"' \
  'printf "%s\n" "$*" >> "$FAKE_RESTIC_LOG"' \
  'command=' \
  'last=' \
  'for arg do' \
  '  last=$arg' \
  '  case "$arg" in backup|check|dump|forget) [ -n "$command" ] || command=$arg ;; esac' \
  'done' \
  'case "$command" in' \
  '  backup)' \
  '    [ -f "${last}.offsite-pending" ] || exit 97' \
  '    rc=$(cat "$FAKE_RESTIC_RC_FILE" 2>/dev/null || printf 96)' \
  '    [ "$rc" -eq 0 ] || exit "$rc"' \
  '    printf "%s\n" '"'"'{"message_type":"summary","snapshot_id":"0123456789abcdef0123456789abcdef"}'"'"'' \
  '    ;;' \
  '  check)' \
  '    exit 0' \
  '    ;;' \
  '  dump)' \
  '    cat -- "$last"' \
  '    ;;' \
  '  forget)' \
  '    exit 0' \
  '    ;;' \
  '  *)' \
  '    exit 96' \
  '    ;;' \
  'esac' \
  > "$FAKE_BIN/restic"
chmod 700 "$FAKE_BIN/restic"
printf 'externes-restic-passwort\n' > "$OFFSITE_PASSWORD"
chmod 600 "$OFFSITE_PASSWORD"

# Zwei nacheinander fehlgeschlagene Runner-Läufe dürfen genau eine lokale
# Generation erzeugen. Der zweite Versuch ist ausschließlich ein
# manifestgeprüfter Remote-Retry und liefert den strukturierten Zustand an den
# Scheduler zurück.
RUNNER_OFFSITE_ZIEL=$TMP/snapshots-runner-offsite
RUNNER_OFFSITE_TARGET_ID=44444444-4444-4444-8444-444444444444
mkdir -p "$RUNNER_OFFSITE_ZIEL"
{
  printf 'Betreuungsbuero-Backupziel/1\n'
  printf 'TARGET_ID=%s\n' "$RUNNER_OFFSITE_TARGET_ID"
  printf 'CREATED_AT=2026-07-28T00:00:00Z\n'
} > "$RUNNER_OFFSITE_ZIEL/.betreuungsbuero-backup-ziel"
printf '23\n' > "$FAKE_RESTIC_RC_FILE"
set +e
RUNNER_OFFSITE_AUSGABE=$( \
  PATH="$FAKE_BIN:$PATH" \
  FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" \
  FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" \
  FAKE_RESTIC_RC=23 \
  RUNNER="$RUNNER" \
  RUNNER_OFFSITE_ZIEL="$RUNNER_OFFSITE_ZIEL" \
  RUNNER_OFFSITE_TARGET_ID="$RUNNER_OFFSITE_TARGET_ID" \
  RUNNER_OFFSITE_SERVER="$SERVER" \
  RUNNER_OFFSITE_DATA="$DATA" \
  RUNNER_OFFSITE_DB="$DB" \
  RUNNER_OFFSITE_BACKUP="$BACKUP" \
  RUNNER_OFFSITE_APP="$APP_FIXTURE" \
  RUNNER_OFFSITE_PASSWORD="$OFFSITE_PASSWORD" \
  RUNNER_OFFSITE_FP="$RECOVERY_FP" \
  node - <<'NODE' 2>&1
const fs = require('fs');
const path = require('path');
const { runTotalBackup } = require(process.env.RUNNER);

async function failedRun(expectedResume, resumeSnapshot = '') {
  let localReady = 0;
  try {
    await runTotalBackup({
      serverDir: process.env.RUNNER_OFFSITE_SERVER,
      dataDir: process.env.RUNNER_OFFSITE_DATA,
      dbPath: process.env.RUNNER_OFFSITE_DB,
      scriptPath: process.env.RUNNER_OFFSITE_BACKUP,
      destination: process.env.RUNNER_OFFSITE_ZIEL,
      expectedTargetId: process.env.RUNNER_OFFSITE_TARGET_ID,
      recoveryKeyFingerprint: process.env.RUNNER_OFFSITE_FP,
      appFile: process.env.RUNNER_OFFSITE_APP,
      consistencyRetries: 0,
      resumeOffsiteOnly: expectedResume,
      resumeSnapshot,
      jobId: 'runner-offsite-retry',
      label: 'runner-offsite-retry',
      offsite: {
        enabled: true,
        mode: 'restic',
        repository: 's3:https://storage.example.invalid/runner-retry',
        passwordFile: process.env.RUNNER_OFFSITE_PASSWORD,
        required: true
      },
      onLocalSnapshotReady(info) {
        localReady += 1;
        if (!!info.resumedOffsite !== expectedResume) {
          throw new Error(`resumedOffsite=${info.resumedOffsite}, erwartet ${expectedResume}`);
        }
      }
    });
    throw new Error('Der erzwungene Restic-Fehler wurde nicht gemeldet.');
  } catch (error) {
    if (!error.localComplete || !error.offsitePending ||
        !!error.resumeOnly !== expectedResume || !error.snapshot) {
      throw error;
    }
    if (localReady !== 1) throw new Error(`lokale Freigaben: ${localReady}`);
    return error.snapshot;
  }
}

(async () => {
  const first = await failedRun(false);
  const second = await failedRun(true, path.basename(first));
  if (first !== second) throw new Error(`Remote-Retry wechselte Snapshot: ${first} -> ${second}`);
  const snapshots = fs.readdirSync(process.env.RUNNER_OFFSITE_ZIEL)
    .filter((name) => name.startsWith('Gesamtsicherung_') &&
      fs.statSync(`${process.env.RUNNER_OFFSITE_ZIEL}/${name}`).isDirectory());
  if (snapshots.length !== 1) {
    throw new Error(`lokale Snapshot-Anzahl nach zwei Remote-Fehlern: ${snapshots.length}`);
  }
  process.stdout.write('RUNNER_OFFSITE_RETRY=OK\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE
)
RUNNER_OFFSITE_RC=$?
set -e
[[ $RUNNER_OFFSITE_RC -eq 0 &&
   $RUNNER_OFFSITE_AUSGABE == *"RUNNER_OFFSITE_RETRY=OK"* ]] ||
  scheitern "Runner erzeugte beim Remote-Retry eine zweite lokale Vollaufnahme: $RUNNER_OFFSITE_AUSGABE"

OFFSITE_JOB_TAG=$(node -e '
  const crypto=require("crypto");
  process.stdout.write("bb-job-"+crypto.createHash("sha256")
    .update("job=manual\n").digest("hex").slice(0,24));
')

printf '0\n' > "$FAKE_RESTIC_RC_FILE"
set +e
OFFSITE_AUSGABE=$(PATH="$FAKE_BIN:$PATH" FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" \
  FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" \
  FAKE_RESTIC_RC=0 bash "$BACKUP" \
  --db "$DB" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_OFFSITE" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --offsite-mode restic \
  --offsite-repository "s3:https://storage.example.invalid/buero" \
  --offsite-password-file "$OFFSITE_PASSWORD" \
  --offsite-tag "fixture" \
  --retention-daily 2 --retention-monthly 1 --retention-yearly 1 \
  --label offsite-ok 2>&1)
OFFSITE_RC=$?
set -e
[[ $OFFSITE_RC -eq 0 && $OFFSITE_AUSGABE == *"OFFSITE=OK"* ]] ||
  scheitern "Erfolgreiche verschluesselte Offsite-Zweitkopie wurde nicht bestaetigt."
grep -Fxq 's3:https://storage.example.invalid/buero' "$FAKE_RESTIC_ARGS" ||
  scheitern "Remote-restic-Repository wurde nicht an restic uebergeben."
grep -Fq 'check --read-data-subset 1/7' "$FAKE_RESTIC_LOG" ||
  scheitern "Die rotierende vollständige Restic-Datenlese wurde nicht gestartet."
grep -Fq "backup --json --tag fixture --tag $OFFSITE_JOB_TAG --" "$FAKE_RESTIC_LOG" ||
  scheitern "Der stabile Job-Tag wurde beim Offsite-Upload nicht zusätzlich gesetzt."
if grep -Eq '(^| )forget( |$)|(^| )prune( |$)' "$FAKE_RESTIC_LOG"; then
  scheitern "Der normale Backup-Prozess hat trotz append-only-Vertrag Remote-Löschoperationen ausgeführt."
fi
[[ $OFFSITE_AUSGABE == *"OFFSITE_RETENTION=EXTERN"* ]] ||
  scheitern "Die getrennte Remote-Retention wurde nicht sichtbar ausgewiesen."
OFFSITE_SNAPSHOT=$(find "$BACKUP_ZIEL_OFFSITE" -type d -name 'Gesamtsicherung_*_offsite-ok' -print | sed -n '1p')
[[ -n $OFFSITE_SNAPSHOT && -f ${OFFSITE_SNAPSHOT}.offsite-status ]] ||
  scheitern "Offsite-Erfolgsstatus fehlt."
OFFSITE_MANIFEST_SHA=$(sha "$OFFSITE_SNAPSHOT/MANIFEST.tsv")
for OFFSITE_STATUS_ZEILE in \
  'Format: Betreuungsbuero-Offsite-Status/2' \
  "Snapshot: ${OFFSITE_SNAPSHOT##*/}" \
  'Target-ID: unmarkiert' \
  "Manifest-SHA-256: $OFFSITE_MANIFEST_SHA"; do
  grep -Fqx "$OFFSITE_STATUS_ZEILE" "${OFFSITE_SNAPSHOT}.offsite-status" ||
    scheitern "Offsite-Erfolgsstatus ist nicht vollständig an Snapshot/Ziel/Manifest gebunden: $OFFSITE_STATUS_ZEILE"
done
grep -Fqx "Restic-Job-Tag: $OFFSITE_JOB_TAG" "${OFFSITE_SNAPSHOT}.offsite-status" ||
  scheitern "Offsite-Erfolgsstatus enthält den stabilen Job-Tag nicht."
if grep -R -a -F -q 'externes-restic-passwort' "$OFFSITE_SNAPSHOT"; then
  scheitern "restic-Passwort ist im lokalen Snapshot enthalten."
fi

# Ein bereits positiv bestätigter lokaler Snapshot bleibt nach einem legitimen
# Profilwechsel retention-fähig. Nur Upload/Retry bleiben ans aktuelle Profil
# gebunden; die lokale Retention prüft den alten Status selbstkonsistent gegen
# Job, Target, Manifest und den stabilen Job-Tag.
printf '0\n' > "$FAKE_RESTIC_RC_FILE"
set +e
PROFILWECHSEL_RETENTION=$(PATH="$FAKE_BIN:$PATH" \
  FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" \
  FAKE_RESTIC_RC=0 bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_OFFSITE" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --offsite-mode restic \
  --offsite-repository "s3:https://storage.example.invalid/neues-profil" \
  --offsite-password-file "$OFFSITE_PASSWORD" \
  --offsite-tag "fixture-neu" \
  --retention-daily 1 --label zzzz-profilwechsel 2>&1)
PROFILWECHSEL_RETENTION_RC=$?
set -e
[[ $PROFILWECHSEL_RETENTION_RC -eq 0 &&
   $PROFILWECHSEL_RETENTION == *"OFFSITE=OK"* &&
   ! -e $OFFSITE_SNAPSHOT &&
   ! -e ${OFFSITE_SNAPSHOT}.offsite-status ]] ||
  scheitern "Ein alter positiver Profilstatus blockierte die lokale Retention: $PROFILWECHSEL_RETENTION"

# Derselbe frei vergebene Tag in demselben Repository darf die Generationen
# eines zweiten Zeitplans nicht in dessen forget/prune-Auswahl aufnehmen.
OFFSITE_ZWEITJOB=zweiter-job
OFFSITE_ZWEITJOB_TAG=$(node -e '
  const crypto=require("crypto");
  process.stdout.write("bb-job-"+crypto.createHash("sha256")
    .update("job="+process.argv[1]+"\n").digest("hex").slice(0,24));
' "$OFFSITE_ZWEITJOB")
[[ $OFFSITE_ZWEITJOB_TAG != "$OFFSITE_JOB_TAG" ]] ||
  scheitern "Zwei Sicherungsjobs erhielten denselben Restic-Job-Tag."
printf '0\n' > "$FAKE_RESTIC_RC_FILE"
set +e
OFFSITE_ZWEITJOB_AUSGABE=$(PATH="$FAKE_BIN:$PATH" \
  FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" \
  FAKE_RESTIC_RC=0 bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_OFFSITE" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --offsite-mode restic \
  --offsite-repository "s3:https://storage.example.invalid/buero" \
  --offsite-password-file "$OFFSITE_PASSWORD" \
  --offsite-tag "fixture" --job-id "$OFFSITE_ZWEITJOB" \
  --retention-daily 2 --label offsite-zweitjob 2>&1)
OFFSITE_ZWEITJOB_RC=$?
set -e
[[ $OFFSITE_ZWEITJOB_RC -eq 0 &&
   $OFFSITE_ZWEITJOB_AUSGABE == *"OFFSITE=OK"* ]] ||
  scheitern "Zweiter Offsite-Job schlug unerwartet fehl: $OFFSITE_ZWEITJOB_AUSGABE"
if grep -Eq '(^| )forget( |$)|(^| )prune( |$)' "$FAKE_RESTIC_LOG"; then
  scheitern "Auch der zweite Job darf im normalen Backup-Prozess keine Remote-Löschrechte verwenden."
fi

printf '23\n' > "$FAKE_RESTIC_RC_FILE"
set +e
OFFSITE_FEHLER=$(PATH="$FAKE_BIN:$PATH" FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" \
  FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" \
  FAKE_RESTIC_RC=23 bash "$BACKUP" \
  --db "$DB" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_OFFSITE" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --offsite-mode restic \
  --offsite-repository "s3:https://storage.example.invalid/buero" \
  --offsite-password-file "$OFFSITE_PASSWORD" \
  --label offsite-fehler 2>&1)
OFFSITE_FEHLER_RC=$?
set -e
[[ $OFFSITE_FEHLER_RC -eq 75 && $OFFSITE_FEHLER == *"OFFSITE=FEHLER"* ]] ||
  scheitern "Fehlgeschlagene Offsite-Zweitkopie war nicht fail-closed (Code $OFFSITE_FEHLER_RC)."
OFFSITE_FEHLER_SNAPSHOT=$(find "$BACKUP_ZIEL_OFFSITE" -type d -name 'Gesamtsicherung_*_offsite-fehler' -print | sed -n '1p')
OFFSITE_FEHLER_SNAPSHOT_ECHT=$(
  OFFSITE_ECHTER_ORDNER=$(CDPATH= cd -- "$(dirname -- "$OFFSITE_FEHLER_SNAPSHOT")" && pwd -P)
  printf '%s/%s\n' "$OFFSITE_ECHTER_ORDNER" "${OFFSITE_FEHLER_SNAPSHOT##*/}"
)
grep -qx FEHLER "${OFFSITE_FEHLER_SNAPSHOT}.offsite-status" ||
  scheitern "Offsite-Fehlerstatus fehlt."
[[ -f ${OFFSITE_FEHLER_SNAPSHOT}.offsite-pending ]] ||
  scheitern "Vor dem Offsite-Upload wurde kein dauerhafter Pending-Zustand angelegt."
OFFSITE_COUNT_VOR_RETRY=$(find "$BACKUP_ZIEL_OFFSITE" -mindepth 1 -maxdepth 1 \
  -type d -name 'Gesamtsicherung_*' -print | wc -l | tr -d ' ')

printf '0\n' > "$FAKE_RESTIC_RC_FILE"
set +e
OFFSITE_RETRY=$(PATH="$FAKE_BIN:$PATH" FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" \
  FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" \
  FAKE_RESTIC_RC=0 bash "$BACKUP" \
  --db "$TMP/remote-only-missing.sqlite3" \
  --data-dir "$TMP/remote-only-missing-data" \
  --server-dir "$TMP/remote-only-missing-server" \
  --destination "$BACKUP_ZIEL_OFFSITE" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --offsite-mode restic \
  --offsite-repository "s3:https://storage.example.invalid/buero" \
  --offsite-password-file "$OFFSITE_PASSWORD" \
  --resume-offsite-only \
  --resume-snapshot "${OFFSITE_FEHLER_SNAPSHOT##*/}" \
  --label offsite-fehler 2>&1)
OFFSITE_RETRY_RC=$?
set -e
[[ $OFFSITE_RETRY_RC -eq 0 &&
   $OFFSITE_RETRY == *"OFFSITE=OK MODUS=restic SNAPSHOT=$OFFSITE_FEHLER_SNAPSHOT_ECHT "*" RESUME=1"* &&
   $OFFSITE_RETRY == *"LOCAL_COMPLETE=1"* ]] ||
  scheitern "Offsite-Folgelauf hat den vorhandenen manifestgeprueften Snapshot nicht wiederaufgenommen (Code $OFFSITE_RETRY_RC): $OFFSITE_RETRY"
OFFSITE_COUNT_NACH_RETRY=$(find "$BACKUP_ZIEL_OFFSITE" -mindepth 1 -maxdepth 1 \
  -type d -name 'Gesamtsicherung_*' -print | wc -l | tr -d ' ')
[[ $OFFSITE_COUNT_NACH_RETRY -eq $OFFSITE_COUNT_VOR_RETRY ]] ||
  scheitern "Reiner Offsite-Folgelauf hat eine unnötige frische lokale Generation erzeugt."
[[ ! -e ${OFFSITE_FEHLER_SNAPSHOT}.offsite-pending ]] ||
  scheitern "Erfolgreicher Offsite-Retry hat den Pending-Zustand nicht entfernt."
grep -qx OK "${OFFSITE_FEHLER_SNAPSHOT}.offsite-status" ||
  scheitern "Offsite-Retry hat keinen erfolgreichen Status hinterlassen."

# Die Pending-Grenze ist nur eine Alarmgrenze. Auch bei aktivierter lokaler
# Retention darf keine der nie remote bestätigten Generationen ihren Sidecar
# verlieren oder gelöscht werden.
QUEUE_PENDING_VOR=$(find "$BACKUP_ZIEL_OFFSITE" -maxdepth 1 -type f \
  -name 'Gesamtsicherung_*.offsite-pending' -print | wc -l | tr -d ' ')
printf '23\n' > "$FAKE_RESTIC_RC_FILE"
for QUEUE_LABEL in offsite-queue-a offsite-queue-b offsite-queue-c; do
  set +e
  QUEUE_AUSGABE=$(PATH="$FAKE_BIN:$PATH" FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" \
    FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" FAKE_RESTIC_RC=23 bash "$BACKUP" \
    --db "$DB" \
    --data-dir "$DATA" \
    --server-dir "$SERVER" \
    --destination "$BACKUP_ZIEL_OFFSITE" \
    --expected-recovery-fingerprint "$RECOVERY_FP" \
    --offsite-mode restic \
    --offsite-repository "s3:https://storage.example.invalid/buero" \
    --offsite-password-file "$OFFSITE_PASSWORD" \
    --offsite-max-pending 1 \
    --retention-daily 1 \
    --label "$QUEUE_LABEL" 2>&1)
  QUEUE_RC=$?
  set -e
  [[ $QUEUE_RC -eq 75 ]] ||
    scheitern "Offsite-Queue-Fixture meldete unerwarteten Code $QUEUE_RC: $QUEUE_AUSGABE"
done
QUEUE_PENDING=$(find "$BACKUP_ZIEL_OFFSITE" -maxdepth 1 -type f \
  -name 'Gesamtsicherung_*.offsite-pending' -print | wc -l | tr -d ' ')
[[ $QUEUE_PENDING -eq $((QUEUE_PENDING_VOR + 3)) &&
   $QUEUE_AUSGABE == *"WARNUNG=OFFSITE_PENDING_UEBERLAUF"*"KEINE_LOESCHUNG=1"* ]] ||
  scheitern "Pending-Überlauf hat Generationen nicht vollständig geschützt (vorher=$QUEUE_PENDING_VOR, nachher=$QUEUE_PENDING, Ausgabe=$QUEUE_AUSGABE)."

# Ein Profilwechsel muss alte offene Generationen sichtbar lassen. Er darf sie
# weder in das neue Repository übernehmen noch aus der lokalen Retention
# herausfallen lassen.
FREMDPROFIL_SNAPSHOT_NAME=$(find "$BACKUP_ZIEL_OFFSITE" -maxdepth 1 -type f \
  -name 'Gesamtsicherung_*.offsite-pending' -print | LC_ALL=C sort | sed -n '1p')
FREMDPROFIL_SNAPSHOT_NAME=${FREMDPROFIL_SNAPSHOT_NAME##*/}
FREMDPROFIL_SNAPSHOT_NAME=${FREMDPROFIL_SNAPSHOT_NAME%.offsite-pending}
[[ -n $FREMDPROFIL_SNAPSHOT_NAME ]] ||
  scheitern "Kein Pending-Snapshot für den Profilwechseltest gefunden."
printf '0\n' > "$FAKE_RESTIC_RC_FILE"
set +e
FREMDPROFIL_AUSGABE=$(PATH="$FAKE_BIN:$PATH" \
  FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" \
  FAKE_RESTIC_RC=0 bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_OFFSITE" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --offsite-mode restic \
  --offsite-repository "s3:https://storage.example.invalid/anderes-profil" \
  --offsite-password-file "$OFFSITE_PASSWORD" \
  --resume-offsite-only --resume-snapshot "$FREMDPROFIL_SNAPSHOT_NAME" \
  --label fremdprofil 2>&1)
FREMDPROFIL_RC=$?
set -e
[[ $FREMDPROFIL_RC -eq 3 &&
   $FREMDPROFIL_AUSGABE == *"WARNUNG=OFFSITE_PENDING_FREMDPROFIL"*"KEINE_LOESCHUNG=1"* ]] ||
  scheitern "Offene Generationen des alten Offsite-Profils wurden nicht sichtbar geschützt: $FREMDPROFIL_AUSGABE"

# Die Admin-Aktion klassifiziert ausschließlich den Sidecar um und löscht
# dabei keine Snapshotdatei. Eine spätere lokale Retention darf nur den
# vollständig gegen Snapshot, Manifest, Job und Target geprüften Abandon-
# Sidecar kontrolliert entfernen. Ein manipulierter Sidecar bleibt fail-closed.
ABANDONED_SNAPSHOT=$BACKUP_ZIEL_OFFSITE/$FREMDPROFIL_SNAPSHOT_NAME
mv -- "${ABANDONED_SNAPSHOT}.offsite-pending" \
  "${ABANDONED_SNAPSHOT}.offsite-abandoned"
[[ -d $ABANDONED_SNAPSHOT && -f ${ABANDONED_SNAPSHOT}.offsite-abandoned ]] ||
  scheitern "Die reine Backlog-Umklassifizierung hat den Snapshot verändert."
ABANDONED_LOG_VORHER=$(wc -l < "$FAKE_RESTIC_LOG" | tr -d ' ')
set +e
ABANDONED_RETRY=$(PATH="$FAKE_BIN:$PATH" \
  FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" \
  FAKE_RESTIC_RC=0 bash "$BACKUP" \
  --db "$TMP/abandoned-remote-only-missing.sqlite3" \
  --data-dir "$TMP/abandoned-remote-only-missing-data" \
  --server-dir "$TMP/abandoned-remote-only-missing-server" \
  --destination "$BACKUP_ZIEL_OFFSITE" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --offsite-mode restic \
  --offsite-repository "s3:https://storage.example.invalid/buero" \
  --offsite-password-file "$OFFSITE_PASSWORD" \
  --offsite-tag "fixture" \
  --resume-offsite-only --resume-snapshot "$FREMDPROFIL_SNAPSHOT_NAME" \
  --label abandoned-nicht-reaktivieren 2>&1)
ABANDONED_RETRY_RC=$?
set -e
ABANDONED_LOG_NACHHER=$(wc -l < "$FAKE_RESTIC_LOG" | tr -d ' ')
[[ $ABANDONED_RETRY_RC -eq 3 &&
   $ABANDONED_RETRY == *"OFFSITE_ABANDONED_NICHT_FORTGESETZT"* &&
   $ABANDONED_LOG_NACHHER -eq $ABANDONED_LOG_VORHER &&
   -f ${ABANDONED_SNAPSHOT}.offsite-abandoned &&
   ! -e ${ABANDONED_SNAPSHOT}.offsite-pending ]] ||
  scheitern "Bewusst aufgegebener Offsite-Snapshot wurde reaktiviert: $ABANDONED_RETRY"
INVALID_ABANDONED_PENDING=$(find "$BACKUP_ZIEL_OFFSITE" -maxdepth 1 -type f \
  -name 'Gesamtsicherung_*.offsite-pending' -print | LC_ALL=C sort | sed -n '1p')
[[ -n $INVALID_ABANDONED_PENDING ]] ||
  scheitern "Kein zweiter Pending-Sidecar für den Negativtest vorhanden."
INVALID_ABANDONED_SNAPSHOT=${INVALID_ABANDONED_PENDING%.offsite-pending}
mv -- "$INVALID_ABANDONED_PENDING" \
  "${INVALID_ABANDONED_SNAPSHOT}.offsite-abandoned"
node - "${INVALID_ABANDONED_SNAPSHOT}.offsite-abandoned" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const changed = text.replace(
  /^MANIFEST_SHA=.*$/m,
  `MANIFEST_SHA=${'0'.repeat(64)}`
);
if (changed === text) process.exit(2);
fs.writeFileSync(file, changed);
NODE
[[ -d $INVALID_ABANDONED_SNAPSHOT ]] ||
  scheitern "Die manipulierte Abandon-Fixture hat den Snapshot vorzeitig gelöscht."

QUEUE_PENDING_LIST=$TMP/queue-pending.list
find "$BACKUP_ZIEL_OFFSITE" -maxdepth 1 -type f \
  -name 'Gesamtsicherung_*.offsite-pending' -print | LC_ALL=C sort > "$QUEUE_PENDING_LIST"
set +e
RETENTION_OHNE_OFFSITE=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_OFFSITE" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --retention-daily 1 --consistency-retries 0 \
  --label retention-ohne-offsite 2>&1)
RETENTION_OHNE_OFFSITE_RC=$?
set -e
[[ $RETENTION_OHNE_OFFSITE_RC -eq 0 &&
   $RETENTION_OHNE_OFFSITE == *"WARNUNG=RETENTION_PENDING_GESCHUETZT"* &&
   $RETENTION_OHNE_OFFSITE == *"ABANDONED_RETENTION=OK"* &&
   $RETENTION_OHNE_OFFSITE == *"WARNUNG=RETENTION_ABANDONED_UNGUELTIG"* ]] ||
  scheitern "Lokale Retention hat offene Offsite-Generationen nicht prof unabhängig geschützt: $RETENTION_OHNE_OFFSITE"
[[ ! -e $ABANDONED_SNAPSHOT &&
   ! -e ${ABANDONED_SNAPSHOT}.offsite-abandoned ]] ||
  scheitern "Gültig aufgegebene Altgeneration wurde nicht kontrolliert bereinigt."
[[ -d $INVALID_ABANDONED_SNAPSHOT &&
   -f ${INVALID_ABANDONED_SNAPSHOT}.offsite-abandoned ]] ||
  scheitern "Manipulierter Abandon-Sidecar wurde entgegen Fail-closed gelöscht."
while IFS= read -r PENDING_DATEI; do
  [[ -f $PENDING_DATEI && -d ${PENDING_DATEI%.offsite-pending} ]] ||
    scheitern "Lokale Retention hat eine offene Offsite-Generation gelöscht: $PENDING_DATEI"
done < "$QUEUE_PENDING_LIST"

# Ein nicht dauerhaft flushbarer Pending-/Snapshotzustand darf weder SNAPSHOT=
# melden noch das erste Remote-Byte starten.
SYNC_FAIL_ZIEL=$TMP/snapshots-sync-fail
SYNC_FAIL_BIN=$TMP/sync-fail-bin
SYNC_FAIL_LOG_ZEILEN_VORHER=$(wc -l < "$FAKE_RESTIC_LOG" | tr -d ' ')
printf '0\n' > "$FAKE_RESTIC_RC_FILE"
mkdir -p "$SYNC_FAIL_ZIEL" "$SYNC_FAIL_BIN"
printf '%s\n' '#!/bin/sh' 'exit 1' > "$SYNC_FAIL_BIN/sync"
chmod 700 "$SYNC_FAIL_BIN/sync"
set +e
SYNC_FAIL_AUSGABE=$(PATH="$SYNC_FAIL_BIN:$FAKE_BIN:$PATH" \
  FAKE_RESTIC_ARGS="$FAKE_RESTIC_ARGS" FAKE_RESTIC_LOG="$FAKE_RESTIC_LOG" \
  FAKE_RESTIC_RC=0 bash "$BACKUP" \
  --db "$DB" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$SYNC_FAIL_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --offsite-mode restic \
  --offsite-repository "s3:https://storage.example.invalid/buero" \
  --offsite-password-file "$OFFSITE_PASSWORD" \
  --label sync-fail 2>&1)
SYNC_FAIL_RC=$?
set -e
SYNC_FAIL_LOG_ZEILEN_NACHHER=$(wc -l < "$FAKE_RESTIC_LOG" | tr -d ' ')
SYNC_FAIL_SIGNAL_COUNT=$(printf '%s\n' "$SYNC_FAIL_AUSGABE" |
  awk '/^SNAPSHOT=/{n++} END{print n+0}')
[[ $SYNC_FAIL_RC -eq 74 && $SYNC_FAIL_SIGNAL_COUNT -eq 0 &&
   $SYNC_FAIL_LOG_ZEILEN_NACHHER -eq $SYNC_FAIL_LOG_ZEILEN_VORHER ]] ||
  scheitern "Fehlgeschlagener dauerhafter Flush wurde nicht vor Erfolg/Upload abgefangen: $SYNC_FAIL_AUSGABE"

# Auch eine Änderung nach dem atomaren Rename, aber während des Flushs, muss die
# zweite vollständige Manifestprüfung erkennen.
POST_MANIFEST_ZIEL=$TMP/snapshots-post-manifest
POST_MANIFEST_BIN=$TMP/post-manifest-bin
POST_MANIFEST_ONCE=$TMP/post-manifest-once
POST_MANIFEST_REAL_SYNC=$(command -v sync)
mkdir -p "$POST_MANIFEST_ZIEL" "$POST_MANIFEST_BIN"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ ! -e $POST_MANIFEST_ONCE ]]; then' \
  '  for candidate in "$@"; do' \
  '    if [[ -d $candidate && ${candidate##*/} == Gesamtsicherung_* ]]; then' \
  '      printf "NACH-MANIFEST-MUTATION\\n" >> "$candidate/STATUS.txt"' \
  '      : > "$POST_MANIFEST_ONCE"' \
  '      break' \
  '    fi' \
  '  done' \
  'fi' \
  'exec "$POST_MANIFEST_REAL_SYNC" "$@"' \
  > "$POST_MANIFEST_BIN/sync"
chmod 700 "$POST_MANIFEST_BIN/sync"
set +e
POST_MANIFEST_AUSGABE=$(PATH="$POST_MANIFEST_BIN:$PATH" \
  POST_MANIFEST_ONCE="$POST_MANIFEST_ONCE" \
  POST_MANIFEST_REAL_SYNC="$POST_MANIFEST_REAL_SYNC" \
  bash "$BACKUP" \
  --db "$DB" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$POST_MANIFEST_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label post-manifest 2>&1)
POST_MANIFEST_RC=$?
set -e
POST_MANIFEST_SIGNAL_COUNT=$(printf '%s\n' "$POST_MANIFEST_AUSGABE" |
  awk '/^SNAPSHOT=/{n++} END{print n+0}')
[[ $POST_MANIFEST_RC -eq 2 && -f $POST_MANIFEST_ONCE &&
   $POST_MANIFEST_SIGNAL_COUNT -eq 0 &&
   $POST_MANIFEST_AUSGABE == *"nach dem dauerhaften Flush nicht mehr manifesttreu"* ]] ||
  scheitern "Abschließende Manifestprüfung hat eine Nach-Rename-Mutation nicht abgefangen: $POST_MANIFEST_AUSGABE"

# Ein Stromausfall zwischen dem atomaren Retention-Rename und dem Löschen darf
# keinen versteckten Vollsnapshot dauerhaft liegen lassen. Der nächste Lauf
# räumt ausschließlich den durch seinen fsync-geschützten Owner belegten
# Tombstone auf und kann danach normal weiterarbeiten.
RETENTION_CRASH_ZIEL=$TMP/snapshots-retention-crash
mkdir -p "$RETENTION_CRASH_ZIEL"
RETENTION_CRASH_BASIS=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$RETENTION_CRASH_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label aaaa-retention-basis 2>&1)
[[ $? -eq 0 && $RETENTION_CRASH_BASIS == *"STATUS=VOLLSTAENDIG"* ]] ||
  scheitern "Retention-Crash-Basis konnte nicht erzeugt werden: $RETENTION_CRASH_BASIS"
set +e
RETENTION_CRASH_AUSGABE=$(NODE_ENV=test \
  GESAMT_BACKUP_TEST_RETENTION_CRASH_AT=after-rename \
  bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$RETENTION_CRASH_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --retention-daily 1 \
  --label zzzz-retention-crash 2>&1)
RETENTION_CRASH_RC=$?
set -e
RETENTION_TOMB_COUNT=$(find "$RETENTION_CRASH_ZIEL" -mindepth 1 -maxdepth 1 \
  -type d -name '.retention-delete-Gesamtsicherung_*' -print | wc -l | tr -d ' ')
RETENTION_OWNER_COUNT=$(find "$RETENTION_CRASH_ZIEL" -mindepth 1 -maxdepth 1 \
  -type f -name '.retention-delete-Gesamtsicherung_*.owner' -print | wc -l | tr -d ' ')
[[ $RETENTION_CRASH_RC -ne 0 &&
   $RETENTION_TOMB_COUNT -eq 1 && $RETENTION_OWNER_COUNT -eq 1 ]] ||
  scheitern "Retention-Crash hinterließ keinen eindeutig belegten Tombstone (RC=$RETENTION_CRASH_RC, Ausgabe=$RETENTION_CRASH_AUSGABE)."
RETENTION_CRASH_RECOVERY=$(bash "$BACKUP" \
  --db "$DB" --data-dir "$DATA" --server-dir "$SERVER" \
  --destination "$RETENTION_CRASH_ZIEL" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label retention-nach-crash 2>&1)
[[ $? -eq 0 &&
   $RETENTION_CRASH_RECOVERY == *"RETENTION_TOMBSTONE_BEREINIGUNG=OK ENTFERNT=1"* &&
   -z $(find "$RETENTION_CRASH_ZIEL" -mindepth 1 -maxdepth 1 \
     \( -name '.retention-delete-*' -o -name '.retention-delete-*.owner' \) -print) ]] ||
  scheitern "Retention-Tombstone wurde beim Folgelauf nicht sicher bereinigt: $RETENTION_CRASH_RECOVERY"

# Sichtbarer Fehlerfall: fehlende DB-Datei erzeugt trotzdem einen atomaren,
# als unvollstaendig benannten Snapshot und Rueckgabecode 2.
sqlite3 "$DB" "
  INSERT INTO doc_files(id,area,case_id,folder_id,name,mime_type,size,sha256)
  VALUES('absichtlich-fehlend','office','','','Fehlt sichtbar.txt','text/plain',7,'');"
mkdir -p "$BACKUP_ZIEL_2"
mv -- "$APP_FIXTURE" "${APP_FIXTURE}.voruebergehend"
set +e
FEHLER_AUSGABE=$(bash "$BACKUP" \
  --db "$DB" \
  --data-dir "$DATA" \
  --server-dir "$SERVER" \
  --destination "$BACKUP_ZIEL_2" \
  --expected-recovery-fingerprint "$RECOVERY_FP" \
  --label fehltest 2>&1)
FEHLER_RC=$?
set -e
mv -- "${APP_FIXTURE}.voruebergehend" "$APP_FIXTURE"
printf '%s\n' "$FEHLER_AUSGABE"
[[ $FEHLER_RC -eq 2 ]] ||
  scheitern "Fehlender Blob haette Rueckgabecode 2 liefern muessen (war $FEHLER_RC)."
UNVOLL=$(find "$BACKUP_ZIEL_2" -mindepth 1 -maxdepth 1 -type d -name '*_UNVOLLSTAENDIG*' -print)
[[ -n $UNVOLL ]] || scheitern "Unvollstaendiger Snapshot wurde nicht sichtbar benannt."
grep -q "absichtlich-fehlend.*Inhaltsdatei fehlt" "$UNVOLL/PRUEFBERICHT.txt" ||
  scheitern "Fehlende Datei steht nicht im Pruefbericht."
grep -q "Keine ausgelieferte App-Datei gefunden" "$UNVOLL/PRUEFBERICHT.txt" ||
  scheitern "Fehlende ausgelieferte Programmversion machte den Snapshot nicht sichtbar unvollstaendig."

# Manipulationsnachweis: Eine nachtraeglich geaenderte Inhaltsdatei wird vor
# dem Erstellen irgendeines Rettungsordners abgelehnt.
printf 'MANIPULIERT\n' >> "$SNAPSHOT/inhalt/server-data/custom-hidden/payload.bin"
MANIPULIERT_ZIEL=$TMP/darf-nicht-entstehen
set +e
bash "$RETTUNG" --snapshot "$SNAPSHOT" --output "$MANIPULIERT_ZIEL" >/dev/null 2>&1
MANIPULIERT_RC=$?
set -e
[[ $MANIPULIERT_RC -ne 0 && ! -e $MANIPULIERT_ZIEL ]] ||
  scheitern "Manifest-Manipulation wurde nicht vor der Rettung abgefangen."

printf '\nALLE TESTS BESTANDEN\n'
printf '  SQLite-WAL in .backup enthalten\n'
printf '  Schema-3-Sicherheitsabbilder strikt geprueft\n'
printf '  Wiederherstellungsschluessel und Runtime-Secret-Verzeichnis ausgeschlossen\n'
printf '  fehlendes externes Ziel durch feste Zielmarke abgefangen\n'
printf '  App, exakter Server-Quellstand, Konfiguration, Vorlagen und Erweiterungspakete inventarisiert\n'
printf '  kontrollierte Generationenverwaltung loescht nur eigene Snapshots\n'
printf '  Diagnose- und verwaiste Arbeitsstufen begrenzt, fremde Ordner unangetastet\n'
printf '  Remote-restic-Zweitkopie fail-closed und ohne doppelten Retry-Snapshot\n'
printf '  Live-DB/WAL nicht als Datei kopiert\n'
printf '  runtime/data und externe Dokumentwurzeln gesichert\n'
printf '  storageRoot + Legacy-baseDir/caseDirs erfasst und dedupliziert\n'
printf '  doc_links aller sieben Module ohne Legacy-Kopie aufgeloest\n'
printf '  Klarnamen-Rettung inkl. TT.MM.JJJJ und geteilter Fotokennung (eine Datei)\n'
printf '  Waisen/kuenftige Module unter _Ohne_Zuordnung erhalten\n'
printf '  fehlender Blob sichtbar, Snapshot atomar als UNVOLLSTAENDIG\n'
printf '  Manifest-Manipulation vor Ausgabe erkannt\n'
