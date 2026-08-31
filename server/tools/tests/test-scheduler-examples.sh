#!/usr/bin/env bash
#
# Rein statische Pruefung der Scheduler-Beispiele. Es wird nichts installiert,
# kein launchd/cron aufgerufen und keine Anwendungsdatenbank geoeffnet.

set -euo pipefail
IFS=$'\n\t'

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
TOOLS_DIR=$(CDPATH= cd -- "$TEST_DIR/.." && pwd -P)
SERVER_DIR=$(CDPATH= cd -- "$TOOLS_DIR/.." && pwd -P)
PLIST=$TOOLS_DIR/scheduler/de.betreuungsbuero.gesamt-backup.plist.example
CRON=$TOOLS_DIR/scheduler/crontab.gesamt-backup.example
ANLEITUNG=$SERVER_DIR/docs/GESAMTSICHERUNG-EINRICHTEN.txt
DOCKERFILE=$SERVER_DIR/Dockerfile
COMPOSE=$SERVER_DIR/docker-compose.yml
ENV_EXAMPLE=$SERVER_DIR/.env.example
OFFSITE_PLIST=$TOOLS_DIR/scheduler/de.betreuungsbuero.offsite-maintenance.plist.example
OFFSITE_CRON=$TOOLS_DIR/scheduler/crontab.offsite-maintenance.example
OFFSITE_DOCKER_PLIST=$TOOLS_DIR/scheduler/de.betreuungsbuero.offsite-maintenance.docker.plist.example
OFFSITE_DOCKER_CRON=$TOOLS_DIR/scheduler/crontab.offsite-maintenance.docker.example
OFFSITE_TOOL=$TOOLS_DIR/offsite-maintenance.sh
BACKUP_TOOL=$TOOLS_DIR/gesamt-backup.sh
RUNTIME_RESTORE_TOOL=$TOOLS_DIR/restore-runtime-artifacts.js

scheitern() {
  printf 'FEHLER: %s\n' "$*" >&2
  exit 1
}

for f in "$PLIST" "$CRON" "$ANLEITUNG" "$DOCKERFILE" "$COMPOSE" "$ENV_EXAMPLE" \
  "$OFFSITE_PLIST" "$OFFSITE_CRON" "$OFFSITE_DOCKER_PLIST" \
  "$OFFSITE_DOCKER_CRON" "$OFFSITE_TOOL" "$BACKUP_TOOL" "$RUNTIME_RESTORE_TOOL"; do
  [[ -f $f ]] || scheitern "Datei fehlt: $f"
done

if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$PLIST" >/dev/null
else
  # Die CI kann Linux sein; dann wenigstens die XML-Struktur ohne Zusatzpaket pruefen.
  command -v xmllint >/dev/null 2>&1 ||
    scheitern "Weder plutil noch xmllint zum Pruefen der plist vorhanden."
  xmllint --noout "$PLIST"
fi

for offsite_plist in "$OFFSITE_PLIST" "$OFFSITE_DOCKER_PLIST"; do
  if command -v plutil >/dev/null 2>&1; then
    plutil -lint "$offsite_plist" >/dev/null
  else
    xmllint --noout "$offsite_plist"
  fi
done

for f in "$PLIST" "$CRON"; do
  grep -Fq '__PROJECT_ROOT__' "$f" ||
    scheitern "Projekt-Platzhalter fehlt in $f"
  grep -Fq '__EXTERNAL_BACKUP_DESTINATION__' "$f" ||
    scheitern "Externer Ziel-Platzhalter fehlt in $f"
  grep -Fq 'gesamt-backup.sh' "$f" ||
    scheitern "Backup-Skript fehlt in $f"
  for arg in --db --data-dir --server-dir --destination; do
    grep -Fq -- "$arg" "$f" || scheitern "$arg fehlt in $f"
  done
  grep -Fq -- '--require-marker' "$f" ||
    scheitern "--require-marker fehlt in $f"
  for arg in --consistency-retries --retention-daily --retention-monthly \
    --retention-yearly --retention-diagnostic --capacity-warning-percent; do
    grep -Fq -- "$arg" "$f" || scheitern "$arg fehlt in $f"
  done
done

grep -Eq '^15 2 \* \* \* ' "$CRON" ||
  scheitern "Cron-Zeitplan ist nicht taeglich 02:15."
grep -Fq '<integer>2</integer>' "$PLIST" ||
  scheitern "launchd-Stunde fehlt."
grep -Fq '<integer>15</integer>' "$PLIST" ||
  scheitern "launchd-Minute fehlt."
grep -Fq 'installiert nichts automatisch' "$ANLEITUNG" ||
  scheitern "Installationssperre fehlt in der Anleitung."
grep -Fq 'getrennten Datentraeger' "$ANLEITUNG" ||
  scheitern "Hinweis auf getrenntes Sicherungsziel fehlt."
grep -Fq '.betreuungsbuero-backup-ziel' "$ANLEITUNG" ||
  scheitern "Zielmarke fehlt in der Anleitung."
grep -Fq 'Remote-restic-' "$ANLEITUNG" ||
  scheitern "Remote-Offsite-Anleitung fehlt."
for paket in bash sqlite3 restic ca-certificates openssh-client rclone procps coreutils findutils \
  tar gzip grep sed gawk; do
  grep -Eq "(^|[[:space:]])${paket}([[:space:]\\\\]|$)" "$DOCKERFILE" ||
    scheitern "Docker-Image installiert das benoetigte Paket nicht: $paket"
done
WERKZEUG_BLOCK=$(sed -n '/^for werkzeug in /,/^done$/p' "$BACKUP_TOOL")
for werkzeug in dirname cat mkdir rmdir chmod; do
  printf '%s\n' "$WERKZEUG_BLOCK" |
    grep -Eq "(^|[[:space:]])${werkzeug}([[:space:];\\\\]|$)" ||
    scheitern "Das Backup prüft sein tatsächlich benutztes Werkzeug nicht vorab: $werkzeug"
done
grep -Fq 'BACKUP_HOST_DIR:?' "$COMPOSE" ||
  scheitern "Compose erzwingt kein externes Backupziel."
grep -Fq 'BACKUP_SECRET_HOST_DIR:?' "$COMPOSE" ||
  scheitern "Compose erzwingt keinen getrennten Backup-Secret-Ordner."
grep -Fq 'target: /run/betreuungsbuero-backup-secrets' "$COMPOSE" ||
  scheitern "Compose bindet den Backup-Secret-Ordner nicht am dokumentierten Containerpfad ein."
BACKUP_SECRET_MOUNT_BLOCK=$(awk '
  /target: \/run\/betreuungsbuero-backup-secrets/ {
    print vorher
    print
    getline
    print
    exit
  }
  { vorher=$0 }
' "$COMPOSE")
printf '%s\n' "$BACKUP_SECRET_MOUNT_BLOCK" |
  grep -Fq 'read_only: true' ||
  scheitern "Compose bindet den Backup-Secret-Ordner nicht schreibgeschützt ein."
grep -Fq 'TOTAL_BACKUP_RESTIC_ENV_FILE=${TOTAL_BACKUP_RESTIC_ENV_FILE:-}' \
  "$COMPOSE" ||
  scheitern "Compose macht die sichere restic-Provider-Credential-Datei nicht explizit optional."
grep -Fq 'TOTAL_BACKUP_OFFSITE_MAINTENANCE_STATUS_DIR=/run/betreuungsbuero-offsite-maintenance-status' \
  "$COMPOSE" ||
  scheitern "Compose bindet den read-only Wartungsstatus nicht an die App-Überwachung."
grep -Fq 'TOTAL_BACKUP_OFFSITE_MAINTENANCE_MAX_AGE_HOURS=' "$COMPOSE" ||
  scheitern "Compose dokumentiert kein Höchstalter für den Wartungsbeleg."
grep -Fq 'OFFSITE_MAINTENANCE_STATUS_HOST_DIR:?' "$COMPOSE" ||
  scheitern "Compose erzwingt keinen bereits vorhandenen Wartungsstatus-Hostordner."
grep -Fq 'OFFSITE_MAINTENANCE_SECRET_HOST_DIR:?' "$COMPOSE" ||
  scheitern "Compose erzwingt keinen getrennten Wartungs-Secret-Hostordner."
grep -Fq 'target: /run/betreuungsbuero-offsite-maintenance-secrets' "$COMPOSE" ||
  scheitern "Der Wartungs-One-shot erhält seinen getrennten Secret-Mount nicht."
grep -Fq 'profiles: ["offsite-maintenance"]' "$COMPOSE" ||
  scheitern "Der getrennte Docker-Wartungs-One-shot ist nicht als ausdrückliches Profil gekapselt."
grep -Fq 'entrypoint: ["/app/server/tools/offsite-maintenance.sh"]' "$COMPOSE" ||
  scheitern "Der Docker-Wartungs-One-shot verwendet nicht das geprüfte Wartungswerkzeug."
APP_COMPOSE_TEIL=$(awk '/^  offsite-maintenance:/{exit} {print}' "$COMPOSE")
if printf '%s\n' "$APP_COMPOSE_TEIL" |
    grep -Fq 'betreuungsbuero-offsite-maintenance-secrets'; then
  scheitern "Der Haupt-App-Service erhält unzulässig löschfähige Wartungs-Credentials."
fi
HAUPT_COMPOSE_TEIL=$(awk '/^  runtime-artifacts-restore:/{exit} {print}' "$COMPOSE")
printf '%s\n' "$HAUPT_COMPOSE_TEIL" |
  grep -Fq -- '../outputs:/app/outputs:ro' ||
  scheitern "Der Hauptservice darf den ausgelieferten outputs-Ordner nicht beschreiben."
printf '%s\n' "$HAUPT_COMPOSE_TEIL" |
  grep -Fq 'RUNTIME_ARTIFACT_RESTORE_STATE_DIR=/app/server/_restore-rollback' ||
  scheitern "Der Hauptservice überwacht nicht denselben persistenten Runtime-Restore-State."
RUNTIME_COMPOSE_TEIL=$(awk '
  /^  runtime-artifacts-restore:/ { aktiv=1 }
  /^  offsite-maintenance:/ { aktiv=0 }
  aktiv { print }
' "$COMPOSE")
printf '%s\n' "$RUNTIME_COMPOSE_TEIL" |
  grep -Fq 'profiles: ["restore"]' ||
  scheitern "Der Runtime-Artefakt-Restore ist nicht als ausdrückliches Restore-Profil gekapselt."
printf '%s\n' "$RUNTIME_COMPOSE_TEIL" |
  grep -Fq 'entrypoint: ["node", "/app/server/tools/restore-runtime-artifacts.js"]' ||
  scheitern "Der Runtime-Artefakt-Restore verwendet nicht das geprüfte Restore-Werkzeug."
printf '%s\n' "$RUNTIME_COMPOSE_TEIL" |
  grep -Fq 'betreuungsbuero-extension-artifacts:/restore/extension-artifacts' ||
  scheitern "Das Erweiterungsvolume ist im Restore-Helfer nicht schreibbar eingebunden."
printf '%s\n' "$RUNTIME_COMPOSE_TEIL" |
  grep -Fq '../outputs:/restore/outputs' ||
  scheitern "Der outputs-Hostordner ist im Restore-Helfer nicht schreibbar eingebunden."
printf '%s\n' "$RUNTIME_COMPOSE_TEIL" |
  grep -Fq 'betreuungsbuero-restore-state:/restore/state' ||
  scheitern "Runtime-Helfer und App teilen keinen persistenten Restore-State."
printf '%s\n' "$RUNTIME_COMPOSE_TEIL" |
  grep -A5 -F 'target: /restore/backups' |
  grep -Fq 'read_only: true' ||
  scheitern "Der Runtime-Artefakt-Restore darf das Sicherungsziel nicht beschreiben."
OFFSITE_COMPOSE_TEIL=$(awk '/^  offsite-maintenance:/{aktiv=1} aktiv {print}' "$COMPOSE")
printf '%s\n' "$OFFSITE_COMPOSE_TEIL" |
  grep -Fq 'OFFSITE_MAINTENANCE_SECRET_HOST_DIR:?' ||
  scheitern "Nur der Wartungsservice muss den Wartungs-Secret-Hostordner einhängen."
printf '%s\n' "$OFFSITE_COMPOSE_TEIL" |
  grep -Fq 'read_only: true' ||
  scheitern "Der Wartungsservice darf seine Host-Credentials nicht verändern."
if grep -Eq '^[[:space:]]*-[[:space:]]*DOCUMENT_RECOVERY_KEY=' "$COMPOSE"; then
  scheitern "Compose reicht den Recovery-Key als auslesbaren Umgebungswert durch."
fi
for zeile in \
  'DATA_DIR=/app/state/data' \
  'RUNTIME_ROOT=/app/state' \
  'DB_PATH=/app/state/database/betreuungsbuero.sqlite3' \
  'DOCUMENTS_DATA_ROOT=/app/state/data' \
  'EXTENSION_ARTIFACTS_DIR=/app/state/extension-artifacts' \
  'betreuungsbuero-state:/app/state' \
  'betreuungsbuero-restore-state:/app/server/_restore-rollback'; do
  grep -Fq "$zeile" "$COMPOSE" ||
    scheitern "Compose unterstützt den atomaren Restore-Unterordner nicht vollständig: $zeile"
done
grep -Fq '/app/state/data' "$ANLEITUNG" ||
  scheitern "Der Compose-Restore auf den atomar tauschbaren Daten-Unterordner ist nicht dokumentiert."
grep -Fq 'docker compose run --rm --no-deps' "$ANLEITUNG" ||
  scheitern "Der isolierte Compose-Restore-Ablauf fehlt in der Anleitung."
grep -Fq 'docker compose --profile restore run --rm --no-deps' "$ANLEITUNG" ||
  scheitern "Der persistente Runtime-Artefakt-Restore fehlt in der Anleitung."
grep -Fq -- '--state-dir /restore/state' "$ANLEITUNG" ||
  scheitern "Die Anleitung verwendet nicht den mit der App geteilten Restore-State."
grep -Fq 'docker compose up -d --no-build --no-deps betreuungsbuero' "$ANLEITUNG" ||
  scheitern "Die Anleitung erzeugt den App-Container auf einem frischen Host nicht neu."
grep -Fq 'docker compose --profile offsite-maintenance run --rm --no-deps' "$ANLEITUNG" ||
  scheitern "Der Docker-One-shot mit getrenntem Löschkonto fehlt in der Anleitung."
grep -Fq 'nicht kryptografisch signiert' "$ANLEITUNG" ||
  scheitern "Die Vertrauensgrenze des nicht signierten Wartungsbelegs ist nicht dokumentiert."
grep -Fq 'nach `docker compose run --rm` wieder verschwunden' "$ANLEITUNG" ||
  scheitern "Die Anleitung behauptet den ephemeren Containerpfad nicht ausdrücklich als flüchtig."
for beleg in 'snapshots --json --tag' \
  'restore "$RESTIC_SNAPSHOT_ID" --target "$RESTIC_STAGING"' \
  'verwaltung/JOB-ID.txt' 'verwaltung/TARGET-ID.txt' \
  'NOTFALL-RETTUNG.sh' 'GESAMT-RESTORE.sh'; do
  grep -Fq "$beleg" "$ANLEITUNG" ||
    scheitern "Der vollständige Offsite-Rückweg fehlt in der Anleitung: $beleg"
done
for f in "$OFFSITE_PLIST" "$OFFSITE_CRON"; do
  grep -Fq 'offsite-maintenance.sh' "$f" ||
    scheitern "Getrenntes Wartungswerkzeug fehlt in $f"
  for placeholder in __REMOTE_RESTIC_REPOSITORY__ __MAINTENANCE_PASSWORD_FILE__ \
    __MAINTENANCE_CREDENTIAL_ENV_FILE__ __MAINTENANCE_STATUS_DIR__ \
    __BACKUP_JOB_ID__; do
    grep -Fq "$placeholder" "$f" ||
      scheitern "Wartungsplatzhalter $placeholder fehlt in $f"
  done
done

for f in "$OFFSITE_DOCKER_PLIST" "$OFFSITE_DOCKER_CRON"; do
  for placeholder in __PROJECT_ROOT__ __DOCKER_BIN__ \
    __EXTERNAL_BACKUP_DESTINATION__ __UPLOAD_SECRET_DIR__ \
    __MAINTENANCE_STATUS_DIR__ __MAINTENANCE_SECRET_DIR__ \
    __MAINTENANCE_CREDENTIAL_ENV_FILE__ __REMOTE_RESTIC_REPOSITORY__ \
    __BACKUP_JOB_ID__ __MAINTENANCE_LOG_FILE__; do
    grep -Fq "$placeholder" "$f" ||
      scheitern "Docker-Wartungsplatzhalter $placeholder fehlt in $f"
  done
  grep -Fq 'docker-compose.yml' "$f" ||
    scheitern "Compose-Datei fehlt im Docker-Wartungsbeispiel $f"
  grep -Fq 'offsite-maintenance' "$f" ||
    scheitern "Wartungsservice fehlt im Docker-Wartungsbeispiel $f"
  grep -Fq -- '--rm' "$f" ||
    scheitern "Docker-Wartungscontainer wird in $f nicht nach dem Lauf entfernt."
  grep -Fq -- '--no-deps' "$f" ||
    scheitern "Docker-Wartung darf in $f nicht die Haupt-App starten."
done
grep -Eq '^30 4 \* \* 0 ' "$OFFSITE_DOCKER_CRON" ||
  scheitern "Docker-Cron-Zeitplan ist nicht sonntags 04:30."
grep -Fq 'crontab.offsite-maintenance.docker.example' "$ANLEITUNG" ||
  scheitern "Docker-Cron-Beispiel fehlt in der Anleitung."
grep -Fq 'de.betreuungsbuero.offsite-maintenance.docker.plist.example' "$ANLEITUNG" ||
  scheitern "Docker-launchd-Beispiel fehlt in der Anleitung."

for variable in SETUP_TOKEN TZ PUBLIC_BASE_URL CALENDAR_SYNC_INTERVAL_SECONDS \
  MAILBOX_WATCH REQUEST_TIMEOUT_MS ENABLE_DOCUMENT_MIGRATION EXT_AI_PROVIDER \
  EXT_UPDATE_VERSION EXT_UPDATE_XPI_URL APP_FILE DOK_GRAPH_BASE DOK_MS_AUTH \
  DOK_MS_TOKEN DOK_GD_AUTH DOK_GD_TOKEN DOK_GD_API DOK_GD_UPLOAD APP_IMAGE; do
  grep -Fq "$variable" "$COMPOSE" ||
    scheitern "Compose führt die Laufzeitvariable nicht explizit: $variable"
  grep -Fq "$variable" "$ENV_EXAMPLE" ||
    scheitern ".env.example dokumentiert die Laufzeitvariable nicht: $variable"
done

grep -Fq '# BEGIN OFFSITE-RESTORE-FAIL-CLOSED' "$ANLEITUNG" ||
  scheitern "Der testbare fail-closed Offsite-Restoreblock fehlt."
grep -Fq 'set -euo pipefail' "$ANLEITUNG" ||
  scheitern "Der Offsite-Restoreblock aktiviert keinen strikten Shellmodus."
if grep -Eq '^[[:space:]]*test -z .*RESTIC_STAGING|^[[:space:]]*test -z .*STAGING' \
    "$ANLEITUNG"; then
  scheitern "Ein alleinstehender Staging-Leertest kann interaktiv übergangen werden."
fi
[[ $(grep -Fc 'staging_eintraege=("$RESTIC_STAGING"/*)' "$ANLEITUNG") -ge 2 ]] ||
  scheitern "Das Restic-Staging wird nicht zu Beginn und unmittelbar vor restore geprüft."
grep -Fq 'rows.length !== 1' "$ANLEITUNG" ||
  scheitern "Die Restic-Metadaten verlangen nicht exakt einen Snapshot."
grep -Fq 'row.paths.length !== 1' "$ANLEITUNG" ||
  scheitern "Der Restorepfad wird nicht aus exakt einem Quellpfad abgeleitet."

# Der dokumentierte Block wird unverändert extrahiert und tatsächlich mit
# einem Restic-Doppel ausgeführt. Damit prüft dieser Test nicht nur Stichworte,
# sondern auch, dass ein befülltes Staging vor jedem Restic-Aufruf stoppt und
# eine mehrdeutige Snapshotabfrage nie bis zu restore gelangt.
RESTORE_TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/bb-runbook-restore.XXXXXXXX")
RESTORE_TEST_SCRIPT=$RESTORE_TEST_ROOT/runbook-restore.sh
RESTORE_TEST_RESTIC=$RESTORE_TEST_ROOT/restic
RESTORE_TEST_PASSWORD=$RESTORE_TEST_ROOT/restic-password
RESTORE_TEST_ID=abababababababababababababababababababababababababababababababab
RESTORE_TEST_TAG=bb-job-0123456789abcdef01234567
RESTORE_TEST_SOURCE=/Volumes/Backup/Gesamtsicherung_20260728_023000_job-test

cleanup_restore_test() {
  if [[ -n ${RESTORE_TEST_ROOT:-} && -d $RESTORE_TEST_ROOT &&
        $RESTORE_TEST_ROOT == "${TMPDIR:-/tmp}"/bb-runbook-restore.* ]]; then
    rm -rf -- "$RESTORE_TEST_ROOT"
  fi
}
trap cleanup_restore_test EXIT

awk '
  /^  # BEGIN OFFSITE-RESTORE-FAIL-CLOSED$/ { block=1; next }
  /^  # END OFFSITE-RESTORE-FAIL-CLOSED$/ { block=0; found=1; exit }
  block { sub(/^  /, ""); print }
  END { if (!found) exit 2 }
' "$ANLEITUNG" > "$RESTORE_TEST_SCRIPT" ||
  scheitern "Der dokumentierte Offsite-Restoreblock ließ sich nicht exakt extrahieren."
[[ -s $RESTORE_TEST_SCRIPT ]] ||
  scheitern "Der extrahierte Offsite-Restoreblock ist leer."

cat > "$RESTORE_TEST_RESTIC" <<'RESTIC_FIXTURE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_RESTIC_LOG"
case " $* " in
  *" snapshots "*)
    if [[ ${FAKE_SNAPSHOT_COUNT:-1} == 2 ]]; then
      printf '[{"id":"%s","tags":["%s"],"paths":["%s"]},{"id":"%s","tags":["%s"],"paths":["%s"]}]\n' \
        "$FAKE_RESTIC_ID" "$FAKE_RESTIC_TAG" "$FAKE_RESTIC_SOURCE" \
        "$FAKE_RESTIC_ID" "$FAKE_RESTIC_TAG" "$FAKE_RESTIC_SOURCE"
    else
      printf '[{"id":"%s","tags":["%s"],"paths":["%s"]}]\n' \
        "$FAKE_RESTIC_ID" "$FAKE_RESTIC_TAG" "$FAKE_RESTIC_SOURCE"
    fi
    ;;
  *" restore "*)
    previous=
    target=
    for argument in "$@"; do
      if [[ $previous == --target ]]; then target=$argument; fi
      previous=$argument
    done
    [[ -n $target ]]
    mkdir -p -- "$target/${FAKE_RESTIC_SOURCE#/}"
    ;;
  *) exit 64 ;;
esac
RESTIC_FIXTURE
chmod 700 "$RESTORE_TEST_RESTIC"
printf 'test-passwort\n' > "$RESTORE_TEST_PASSWORD"
chmod 600 "$RESTORE_TEST_PASSWORD"

RESTORE_TEST_EMPTY=$RESTORE_TEST_ROOT/empty
RESTORE_TEST_LOG=$RESTORE_TEST_ROOT/empty.log
mkdir "$RESTORE_TEST_EMPTY"
RESTIC_REPOSITORY=fixture:test \
RESTIC_PASSWORD_FILE=$RESTORE_TEST_PASSWORD \
RESTIC_JOB_TAG=$RESTORE_TEST_TAG \
RESTIC_SNAPSHOT_ID=$RESTORE_TEST_ID \
RESTIC_STAGING=$RESTORE_TEST_EMPTY \
RESTIC_BIN=$RESTORE_TEST_RESTIC \
FAKE_RESTIC_LOG=$RESTORE_TEST_LOG \
FAKE_RESTIC_ID=$RESTORE_TEST_ID \
FAKE_RESTIC_TAG=$RESTORE_TEST_TAG \
FAKE_RESTIC_SOURCE=$RESTORE_TEST_SOURCE \
  bash "$RESTORE_TEST_SCRIPT" > "$RESTORE_TEST_ROOT/empty.out"
[[ -d $RESTORE_TEST_EMPTY/${RESTORE_TEST_SOURCE#/} ]] ||
  scheitern "Der sichere Runbook-Block leitete den Restorepfad nicht deterministisch ab."
[[ $(grep -Fc ' restore ' "$RESTORE_TEST_LOG") -eq 1 ]] ||
  scheitern "Der sichere Runbook-Block führte restore nicht exakt einmal aus."
grep -Fq 'SNAPSHOT=' "$RESTORE_TEST_ROOT/empty.out" ||
  scheitern "Der sichere Runbook-Block gibt den geprüften Snapshotpfad nicht aus."

RESTORE_TEST_NONEMPTY=$RESTORE_TEST_ROOT/nonempty
RESTORE_TEST_NONEMPTY_LOG=$RESTORE_TEST_ROOT/nonempty.log
mkdir "$RESTORE_TEST_NONEMPTY"
printf 'darf nicht überschrieben werden\n' > "$RESTORE_TEST_NONEMPTY/bestand.txt"
set +e
RESTIC_REPOSITORY=fixture:test \
RESTIC_PASSWORD_FILE=$RESTORE_TEST_PASSWORD \
RESTIC_JOB_TAG=$RESTORE_TEST_TAG \
RESTIC_SNAPSHOT_ID=$RESTORE_TEST_ID \
RESTIC_STAGING=$RESTORE_TEST_NONEMPTY \
RESTIC_BIN=$RESTORE_TEST_RESTIC \
FAKE_RESTIC_LOG=$RESTORE_TEST_NONEMPTY_LOG \
FAKE_RESTIC_ID=$RESTORE_TEST_ID \
FAKE_RESTIC_TAG=$RESTORE_TEST_TAG \
FAKE_RESTIC_SOURCE=$RESTORE_TEST_SOURCE \
  bash "$RESTORE_TEST_SCRIPT" > "$RESTORE_TEST_ROOT/nonempty.out" 2>&1
RESTORE_TEST_RC=$?
set -e
((RESTORE_TEST_RC != 0)) ||
  scheitern "Der Runbook-Block akzeptiert fälschlich ein nichtleeres Staging."
[[ ! -e $RESTORE_TEST_NONEMPTY_LOG ]] ||
  scheitern "Bei nichtleerem Staging wurde Restic dennoch aufgerufen."

RESTORE_TEST_AMBIGUOUS=$RESTORE_TEST_ROOT/ambiguous
RESTORE_TEST_AMBIGUOUS_LOG=$RESTORE_TEST_ROOT/ambiguous.log
mkdir "$RESTORE_TEST_AMBIGUOUS"
set +e
RESTIC_REPOSITORY=fixture:test \
RESTIC_PASSWORD_FILE=$RESTORE_TEST_PASSWORD \
RESTIC_JOB_TAG=$RESTORE_TEST_TAG \
RESTIC_SNAPSHOT_ID=$RESTORE_TEST_ID \
RESTIC_STAGING=$RESTORE_TEST_AMBIGUOUS \
RESTIC_BIN=$RESTORE_TEST_RESTIC \
FAKE_RESTIC_LOG=$RESTORE_TEST_AMBIGUOUS_LOG \
FAKE_RESTIC_ID=$RESTORE_TEST_ID \
FAKE_RESTIC_TAG=$RESTORE_TEST_TAG \
FAKE_RESTIC_SOURCE=$RESTORE_TEST_SOURCE \
FAKE_SNAPSHOT_COUNT=2 \
  bash "$RESTORE_TEST_SCRIPT" > "$RESTORE_TEST_ROOT/ambiguous.out" 2>&1
RESTORE_TEST_RC=$?
set -e
((RESTORE_TEST_RC != 0)) ||
  scheitern "Der Runbook-Block akzeptiert fälschlich mehrere Snapshottreffer."
if grep -Fq ' restore ' "$RESTORE_TEST_AMBIGUOUS_LOG"; then
  scheitern "Bei mehrdeutiger Snapshotabfrage wurde restore dennoch aufgerufen."
fi

printf 'OK: launchd-/cron-Beispiele sind syntaktisch und sicherheitsseitig geprueft.\n'
