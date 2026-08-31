#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
TOOLS_DIR=$(CDPATH= cd -- "$TEST_DIR/.." && pwd -P)
SERVER_DIR=$(CDPATH= cd -- "$TOOLS_DIR/.." && pwd -P)
BACKUP=$TOOLS_DIR/gesamt-backup.sh
MAINTENANCE=$TOOLS_DIR/offsite-maintenance.js
RUNNER=$SERVER_DIR/src/modules/backup/runner.js

fail() {
  printf 'FEHLER: %s\n' "$*" >&2
  exit 1
}

for file in "$BACKUP" "$MAINTENANCE" "$RUNNER"; do
  [[ -f $file ]] || fail "Datei fehlt: $file"
done

BACKUP_RETENTION=$(awk '
  /^offsite_retention_anwenden\(\)/ { inside=1 }
  inside { print }
  inside && /^}/ { exit }
' "$BACKUP")

[[ $BACKUP_RETENTION == *'OFFSITE_RETENTION=EXTERN'* ]] ||
  fail "Der Hauptbackup-Lauf weist die externe Retention nicht aus."
if grep -Eq 'restic_sicher|args=\(forget|["'\'']forget["'\'']|--prune' \
    <<< "$BACKUP_RETENTION"; then
  fail "Der Hauptbackup-Lauf enthält weiterhin einen ausführbaren forget/prune-Pfad."
fi
grep -Fq -- '--offsite-retention-mode' "$RUNNER" ||
  fail "Der Node-Runner erzwingt den externen Retentionmodus nicht."
grep -Fq "'--offsite-retention-mode', 'external'" "$RUNNER" ||
  fail "Der Node-Runner übergibt keinen fest verdrahteten externen Retentionmodus."

grep -Fq "'forget'," "$MAINTENANCE" ||
  fail "Das getrennte Wartungswerkzeug führt forget nicht aus."
grep -Fq "forget.push('--prune')" "$MAINTENANCE" ||
  fail "Das getrennte Wartungswerkzeug führt prune nicht aus."
grep -Fq "'check'" "$MAINTENANCE" ||
  fail "Das getrennte Wartungswerkzeug prüft das Repository nicht."

printf 'OK: Remote-Löschoperationen sind vom normalen Backup-Prozess getrennt.\n'
