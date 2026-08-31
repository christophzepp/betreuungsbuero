#!/usr/bin/env bash
#
# Isolierter API-Pruefstand fuer die Zeitplan-Zielart "gesamt".
# Der Serverbaum, die DB, Datenwurzel, Zielmappe und der Port sind Testkopien.

set -euo pipefail
IFS=$'\n\t'
umask 077

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PROJECT_SERVER=$(CDPATH= cd -- "$TEST_DIR/../.." && pwd -P)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/backup-job-api-test.XXXXXXXX")
COPY_SERVER=$TMP/server
DB=$TMP/test.sqlite3
DATA=$TMP/data
TARGET=$TMP/externes-sicherungsziel
COOKIE=$TMP/cookie.txt
LOG=$TMP/server.log
RECOVERY_KEY_FILE=$TMP/secrets/document-recovery-key
SERVER_PID=
PORT=$((32000 + ($$ % 20000)))

aufräumen() {
  rc=$?
  if [[ -n ${SERVER_PID:-} ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  [[ -n ${TMP:-} && -d $TMP ]] && rm -rf -- "$TMP"
  exit "$rc"
}
trap aufräumen EXIT HUP INT TERM

scheitern() {
  printf 'FEHLER: %s\n' "$*" >&2
  if [[ -n ${TMP:-} && -d $TMP ]]; then
    for antwort in "$TMP"/*.json; do
      [[ -f $antwort ]] || continue
      printf '\n--- %s ---\n' "$antwort" >&2
      sed -n '1,120p' "$antwort" >&2
    done
    while IFS= read -r pruefbericht; do
      [[ -f $pruefbericht ]] || continue
      printf '\n--- %s ---\n' "$pruefbericht" >&2
      sed -n '1,220p' "$pruefbericht" >&2
    done < <(find "$TARGET" -maxdepth 2 -type f -name PRUEFBERICHT.txt -print 2>/dev/null)
  fi
  [[ ! -f $LOG ]] || tail -n 80 "$LOG" >&2
  exit 1
}

for werkzeug in rsync curl node find; do
  command -v "$werkzeug" >/dev/null 2>&1 ||
    scheitern "Benoetigtes Werkzeug fehlt: $werkzeug"
done

mkdir -p "$COPY_SERVER" "$DATA" "$TARGET" "$TMP/outputs"
rsync -a \
  --exclude data \
  --exclude '*.sqlite3' \
  --exclude '*.sqlite3-wal' \
  --exclude '*.sqlite3-shm' \
  --exclude .env \
  "$PROJECT_SERVER/" "$COPY_SERVER/"
printf '<!doctype html><title>isolierte Backup-API-Test-App</title>\n' \
  > "$TMP/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html"

COPY_SERVER="$COPY_SERVER" DB_PATH="$DB" node <<'NODE'
const path = require('path');
const bcrypt = require(path.join(process.env.COPY_SERVER, 'node_modules', 'bcrypt'));
const db = require(path.join(process.env.COPY_SERVER, 'src', 'database'));
const hash = bcrypt.hashSync('Nur-Test-2026!', 4);
db.prepare(`
  INSERT INTO users
    (username, password_hash, display_name, allow_local, allow_online,
     is_admin, allow_case_management)
  VALUES (?, ?, ?, 1, 1, 1, 1)
`).run('backup-admin', hash, 'Backup Test');
db.close();
NODE

mkdir -p -- "$(dirname -- "$RECOVERY_KEY_FILE")"
COPY_SERVER="$COPY_SERVER" \
DOCUMENTS_DATA_ROOT="$DATA" \
DOCUMENT_RECOVERY_KEY_FILE="$RECOVERY_KEY_FILE" \
node <<'NODE'
const path = require('path');
const store = require(
  path.join(process.env.COPY_SERVER, 'src', 'modules', 'recovery', 'key-store')
).shared();
store.setKey(store.generate());
NODE

DB_PATH="$DB" \
DOCUMENTS_DATA_ROOT="$DATA" \
DOCUMENT_RECOVERY_KEY_FILE="$RECOVERY_KEY_FILE" \
OUTPUTS_DIR="$TMP/outputs" \
CALENDAR_SYNC_INTERVAL_SECONDS=0 \
SESSION_SECRET='isolierter-backup-api-test-kein-produktivgeheimnis' \
ENCRYPTION_KEY='0000000000000000000000000000000000000000000000000000000000000000' \
PORT="$PORT" \
node "$COPY_SERVER/index.js" >"$LOG" 2>&1 &
SERVER_PID=$!

BASIS=http://127.0.0.1:$PORT
BEREIT=nein
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -sS --max-time 1 "$BASIS/api/me" >/dev/null 2>&1; then
    BEREIT=ja
    break
  fi
  sleep 0.25
done
[[ $BEREIT == ja ]] || scheitern "Testserver wurde auf Port $PORT nicht bereit."

LOGIN_CODE=$(curl -sS -o "$TMP/login.json" -w '%{http_code}' \
  -c "$COOKIE" \
  -H 'Content-Type: application/json' \
  --data '{"username":"backup-admin","password":"Nur-Test-2026!","mode":"online"}' \
  "$BASIS/api/login")
[[ $LOGIN_CODE == 200 ]] || scheitern "Login lieferte HTTP $LOGIN_CODE."

# Der Test verwendet denselben ausdrücklichen Admin-Ablauf wie die Oberfläche:
# Vorprüfung -> bestätigte Initialisierung -> erneute technische Vorprüfung.
PREFLIGHT_CODE=$(curl -sS -o "$TMP/preflight-vorher.json" -w '%{http_code}' \
  -b "$COOKIE" \
  -H 'Content-Type: application/json' \
  --data '{"ziel":{"art":"gesamt","ordner":"'"$TARGET"'"},"options":{}}' \
  "$BASIS/api/documents/backup-preflight")
[[ $PREFLIGHT_CODE == 200 ]] ||
  scheitern "Vorprüfung des uninitialisierten Ziels lieferte HTTP $PREFLIGHT_CODE."
node - "$TMP/preflight-vorher.json" <<'NODE' ||
const value = require(process.argv[2]);
if (!value.target || value.target.markerPresent !== false
    || value.target.markerValid !== false || value.technicalReady !== false) process.exit(1);
NODE
  scheitern "Vorprüfung hat das uninitialisierte Ziel nicht fail-closed ausgewiesen."

INIT_OHNE_CODE=$(curl -sS -o "$TMP/init-ohne-bestaetigung.json" -w '%{http_code}' \
  -b "$COOKIE" \
  -H 'Content-Type: application/json' \
  --data '{"ordner":"'"$TARGET"'"}' \
  "$BASIS/api/documents/backup-target/initialize")
[[ $INIT_OHNE_CODE == 400 && ! -e $TARGET/.betreuungsbuero-backup-ziel ]] ||
  scheitern "Zielinitialisierung ohne ausdrückliche Bestätigung war nicht gesperrt."

INIT_CODE=$(curl -sS -o "$TMP/init.json" -w '%{http_code}' \
  -b "$COOKIE" \
  -H 'Content-Type: application/json' \
  --data '{"ordner":"'"$TARGET"'","confirm":true}' \
  "$BASIS/api/documents/backup-target/initialize")
[[ $INIT_CODE == 201 ]] ||
  scheitern "Bestätigte Zielinitialisierung lieferte HTTP $INIT_CODE."
TARGET_ID=$(node -e "
  const j=require(process.argv[1]);
  if (!j.created || !j.target || !/^[0-9a-f-]{36}$/.test(j.target.targetId || '')) process.exit(1);
  process.stdout.write(j.target.targetId);
" "$TMP/init.json") ||
  scheitern "Initialisierung lieferte keine gültige TARGET_ID."
[[ -s $TARGET/.betreuungsbuero-backup-ziel ]] ||
  scheitern "Admin-Initialisierung hat keine Zielmarke angelegt."

PREFLIGHT_CODE=$(curl -sS -o "$TMP/preflight-nachher.json" -w '%{http_code}' \
  -b "$COOKIE" \
  -H 'Content-Type: application/json' \
  --data '{"ziel":{"art":"gesamt","ordner":"'"$TARGET"'"},"options":{"backupTargetId":"'"$TARGET_ID"'","capacity":{"warningPercent":0}}}' \
  "$BASIS/api/documents/backup-preflight")
[[ $PREFLIGHT_CODE == 200 ]] ||
  scheitern "Vorprüfung des initialisierten Ziels lieferte HTTP $PREFLIGHT_CODE."
node - "$TMP/preflight-nachher.json" "$TARGET_ID" <<'NODE' ||
const value = require(process.argv[2]);
if (!value.target || value.target.markerValid !== true
    || value.target.targetId !== process.argv[3]
    || value.target.targetMatches !== true
    || !value.readiness || value.readiness.localReady !== true
    || value.readiness.recoveryReady !== true
    || value.technicalReady !== false) process.exit(1);
NODE
  scheitern "Vorprüfung hat lokales Ziel/Recovery nicht freigegeben oder den fehlenden Offsite-Schutz nicht sichtbar gelassen."

post_job() {
  local body=$1 out=$2
  curl -sS -o "$out" -w '%{http_code}' \
    -b "$COOKIE" \
    -H 'Content-Type: application/json' \
    --data "$body" \
    "$BASIS/api/documents/backup-jobs"
}

CODE=$(post_job \
  '{"label":"relativ","interval":"taeglich","timeHhmm":"02:15","quelle":{"bereich":"alles"},"ziel":{"art":"gesamt","ordner":"relative/sicherung"}}' \
  "$TMP/relativ.json")
[[ $CODE == 400 ]] || scheitern "Relatives Gesamtsicherungsziel lieferte HTTP $CODE statt 400."

CODE=$(post_job \
  '{"label":"intern","interval":"taeglich","timeHhmm":"02:15","quelle":{"bereich":"alles"},"ziel":{"art":"gesamt","ordner":"'"$COPY_SERVER"'/backup"}}' \
  "$TMP/intern.json")
[[ $CODE == 400 ]] || scheitern "Internes Gesamtsicherungsziel lieferte HTTP $CODE statt 400."

CODE=$(post_job \
  '{"label":"falsche-quelle","interval":"taeglich","timeHhmm":"02:15","quelle":{"bereich":"office"},"ziel":{"art":"gesamt","ordner":"'"$TARGET"'"}}' \
  "$TMP/quelle.json")
[[ $CODE == 400 ]] || scheitern "Teilquelle fuer Gesamtsicherung lieferte HTTP $CODE statt 400."

CODE=$(post_job \
  '{"label":"zu-oft","interval":"stuendlich","timeHhmm":"00:00","quelle":{"bereich":"alles"},"ziel":{"art":"gesamt","ordner":"'"$TARGET"'"}}' \
  "$TMP/stuendlich.json")
[[ $CODE == 400 ]] || scheitern "Stuendliche Gesamtsicherung lieferte HTTP $CODE statt 400."

CODE=$(post_job \
  '{"label":"API-Pruefung","interval":"taeglich","timeHhmm":"02:15","quelle":{"bereich":"alles"},"ziel":{"art":"gesamt","ordner":"'"$TARGET"'"},"options":{"capacity":{"warningPercent":0},"retention":{"enabled":false,"minFreeGb":0}}}' \
  "$TMP/job.json")
[[ $CODE == 201 ]] || scheitern "Gueltiger Zeitplan lieferte HTTP $CODE statt 201."

JOB_ID=$(node -e "const j=require(process.argv[1]);if(!j.id)process.exit(1);process.stdout.write(String(j.id))" "$TMP/job.json") ||
  scheitern "Zeitplan-Antwort enthaelt keine ID."

RUN_CODE=$(curl -sS -o "$TMP/run.json" -w '%{http_code}' \
  -b "$COOKIE" \
  -H 'Content-Type: application/json' \
  --data '{}' \
  "$BASIS/api/documents/backup-jobs/$JOB_ID/run")
[[ $RUN_CODE == 202 ]] || scheitern "Jetzt-ausfuehren lieferte HTTP $RUN_CODE statt 202."

FERTIG=nein
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
  curl -sS -b "$COOKIE" "$BASIS/api/documents/backup-jobs" > "$TMP/jobs.json"
  LAST=$(node -e "
    const j=require(process.argv[1]).jobs.find(x=>x.id===process.argv[2]);
    process.stdout.write(j?String(j.lastResult||''):'');
  " "$TMP/jobs.json" "$JOB_ID")
  if [[ $LAST == ok:* ]]; then
    FERTIG=ja
    break
  fi
  [[ $LAST != Fehler:* ]] || scheitern "Gesamtsicherung meldete: $LAST"
  sleep 0.25
done
[[ $FERTIG == ja ]] || scheitern "Gesamtsicherung wurde nicht rechtzeitig fertig."

SNAPSHOT=$(find "$TARGET" -mindepth 1 -maxdepth 1 -type d -name 'Gesamtsicherung_*' -print)
[[ -n $SNAPSHOT ]] || scheitern "Zeitplan hat keinen Snapshot veroeffentlicht."
[[ -f $SNAPSHOT/datenbank/betreuungsbuero.sqlite3 ]] ||
  scheitern "SQLite-.backup-Kopie fehlt im Snapshot."
[[ -f $SNAPSHOT/NOTFALL-RETTUNG.sh ]] ||
  scheitern "Rettungsskript fehlt im Snapshot."
grep -qx VOLLSTAENDIG "$SNAPSHOT/STATUS.txt" ||
  scheitern "Zeitplan-Snapshot ist nicht VOLLSTAENDIG."

printf 'backup-job-api: OK (isolierter Server, eigene DB, eigener Port %s)\n' "$PORT"
