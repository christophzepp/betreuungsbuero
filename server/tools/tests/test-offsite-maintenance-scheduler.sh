#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
TOOLS_DIR=$(CDPATH= cd -- "$TEST_DIR/.." && pwd -P)
PLIST=$TOOLS_DIR/scheduler/de.betreuungsbuero.offsite-maintenance.plist.example
CRON=$TOOLS_DIR/scheduler/crontab.offsite-maintenance.example

fail() {
  printf 'FEHLER: %s\n' "$*" >&2
  exit 1
}

for file in "$PLIST" "$CRON"; do
  [[ -f $file ]] || fail "Scheduler-Beispiel fehlt: $file"
  for marker in \
    '__PROJECT_ROOT__' '__REMOTE_RESTIC_REPOSITORY__' \
    '__MAINTENANCE_PASSWORD_FILE__' '__MAINTENANCE_CREDENTIAL_ENV_FILE__' \
    '__MAINTENANCE_STATUS_DIR__' '__BACKUP_JOB_ID__'; do
    grep -Fq "$marker" "$file" || fail "$marker fehlt in $file"
  done
  grep -Fq 'offsite-maintenance.sh' "$file" ||
    fail "Getrenntes Wartungsskript fehlt in $file"
  for arg in --repository --password-file --credential-env-file --status-dir \
    --job-id --keep-daily --keep-monthly --keep-yearly; do
    grep -Fq -- "$arg" "$file" || fail "$arg fehlt in $file"
  done
done

if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$PLIST" >/dev/null
elif command -v xmllint >/dev/null 2>&1; then
  xmllint --noout "$PLIST"
else
  fail "Weder plutil noch xmllint ist zur plist-Prüfung verfügbar."
fi

grep -Eq '^30 4 \* \* 0 ' "$CRON" ||
  fail "Cron-Wartung läuft nicht sonntags um 04:30 Uhr."
grep -Fq '<key>Weekday</key>' "$PLIST" ||
  fail "launchd-Wochentag fehlt."
grep -Fq '<integer>1</integer>' "$PLIST" ||
  fail "launchd-Sonntag fehlt."
grep -Fq '<integer>4</integer>' "$PLIST" ||
  fail "launchd-Stunde fehlt."
grep -Fq '<integer>30</integer>' "$PLIST" ||
  fail "launchd-Minute fehlt."

printf 'OK: getrennte Offsite-Wartungszeitpläne sind statisch geprüft.\n'
