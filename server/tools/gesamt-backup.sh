#!/usr/bin/env bash
#
# Konsistente, softwareunabhaengige Gesamtsicherung.
#
# Das Skript hat bewusst keine Vorgabepfade fuer Datenbank oder Datenverzeichnis.
# Dadurch kann ein manueller Test nicht versehentlich zur Sicherung der laufenden
# Installation werden. Die Quelldatenbank wird ausschliesslich durch SQLite ".backup"
# geoeffnet; alle Auswertungen erfolgen danach auf der Sicherungskopie.

set -euo pipefail
IFS=$'\n\t'
umask 077

PROGRAMM=${0##*/}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SERVER_DIR_VORGABE=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

# Der äussere Aufruf kann einen als unvollständig erkannten Mischstand begrenzt
# erneut lesen. Jeder Einzelversuch bleibt ein normaler, atomarer Lauf und
# veröffentlicht seinen eigenen sichtbaren Prüfbericht. Die Umgebungsvariable
# ist ausschließlich eine interne Rekursionssperre; Nutzer konfigurieren nur
# --consistency-retries.
if [[ -z ${GESAMT_BACKUP_INNER_ATTEMPT:-} ]]; then
  WIEDERHOLUNGEN=0
  VORHER=
  for ARG in "$@"; do
    if [[ $VORHER == --consistency-retries ]]; then
      WIEDERHOLUNGEN=$ARG
      break
    fi
    VORHER=$ARG
  done
  if [[ ! $WIEDERHOLUNGEN =~ ^[0-5]$ ]]; then
    printf '%s: --consistency-retries muss zwischen 0 und 5 liegen.\n' "$PROGRAMM" >&2
    exit 64
  fi
  if ((WIEDERHOLUNGEN > 0)); then
    GESAMT_VERSUCHE=$((WIEDERHOLUNGEN + 1))
    VERSUCH=1
    while ((VERSUCH <= GESAMT_VERSUCHE)); do
      printf 'KONSISTENZVERSUCH=%d/%d\n' "$VERSUCH" "$GESAMT_VERSUCHE"
      set +e
      GESAMT_BACKUP_INNER_ATTEMPT=$VERSUCH "$0" "$@"
      RC=$?
      set -e
      if ((RC != 2 || VERSUCH == GESAMT_VERSUCHE)); then
        exit "$RC"
      fi
      printf 'WIEDERHOLUNG=UNVOLLSTAENDIGER_MISCHSTAND\n'
      VERSUCH=$((VERSUCH + 1))
    done
  fi
fi

DB_QUELLE=
DATEN_QUELLE=
ZIEL_BASIS=
SERVER_DIR=$SERVER_DIR_VORGABE
APP_DATEI=
TEMPLATES_DIR=
EXTENSION_ARTIFACTS_DIR=
OCR_ASSETS_DIR=
BEZEICHNUNG=
MARKER_ERFORDERLICH=0
ERWARTETE_ZIEL_ID=
ZIEL_ID=
JOB_ID=manual
JOB_TOKEN=manual
RECOVERY_AUSNAHME=0
ERWARTETER_RECOVERY_FP=
KONSISTENZ_WIEDERHOLUNGEN=0
RETENTION_DAILY=0
RETENTION_MONTHLY=0
RETENTION_YEARLY=0
RETENTION_DIAGNOSTIC=0
KAPAZITAET_PROZENT=0
KAPAZITAET_BYTES=0
OFFSITE_MODE=none
OFFSITE_REPOSITORY=
OFFSITE_PASSWORD_FILE=
OFFSITE_TAG=betreuungsbuero
OFFSITE_JOB_TAG=
OFFSITE_REQUIRED=yes
OFFSITE_RETENTION_MODE=external
OFFSITE_MAX_PENDING=14
OFFSITE_CHECK_DAYS=7
OFFSITE_READ_SLICES=7
OFFSITE_STATE_DIR=
RESTIC_BIN=
ENV_BIN=
RESUME_OFFSITE_ONLY=0
RESUME_SNAPSHOT_NAME=
STAGE=
STAGE_OWNER=
LOCK_DIR=
LOCK_TOKEN=
LOCK_OWNED=0
FEHLER=0
ERWARTET=0
GEPRUEFT=0

hilfe() {
  cat <<'EOF'
Aufruf:
  gesamt-backup.sh --db DATEI --data-dir ORDNER --destination ORDNER
                    [--server-dir ORDNER] [--app-file DATEI] [--label TEXT]
                    [--require-marker] [--expected-target-id UUID]
                    [--job-id KENNUNG] [--consistency-retries 0..5]
                    [--retention-daily N] [--retention-monthly N]
                    [--retention-yearly N] [--retention-diagnostic N]
                    [--capacity-warning-percent N]
                    [--capacity-warning-bytes N]
                    [--expected-recovery-fingerprint HEX]
                    [--offsite-mode restic --offsite-repository ZIEL
                     --offsite-password-file DATEI [--offsite-tag TEXT]]
                    [--offsite-retention-mode external]
                    [--resume-offsite-only --resume-snapshot NAME]

Pflichtargumente:
  --db            SQLite-Datenbank der Anwendung. Sie wird nur mit ".backup" gelesen.
  --data-dir      Datenwurzel (normalerweise runtime/data). Sie wird vollstaendig gesichert.
  --destination   Uebergeordneter Zielordner fuer atomar veroeffentlichte Snapshots.

Optionen:
  --server-dir    Bezugspunkt fuer relative externe Dokumentwurzeln (Vorgabe: server/).
  --app-file      Ausgelieferte Single-File-App. Ohne Angabe wird genau eine passende
                  Datei unter ../outputs automatisch erkannt und mitgesichert.
  --label         Kurzer Zusatz fuer den Snapshot-Namen.
  --require-marker
                  Das bereits vorhandene Ziel muss die regulaere Datei
                  ".betreuungsbuero-backup-ziel" enthalten. Fuer automatische
                  Laeufe empfohlen: Ein nicht eingehangenes Ziel scheitert sichtbar,
                  statt versehentlich auf die interne Platte zu schreiben.
  --expected-target-id
                  Bindet den Lauf zusätzlich an die UUID der Zielmarke.
  --job-id        Stabile Kennung des App-Zeitplans. Retention und Offsite-
                  Warteschlange bleiben dadurch strikt diesem Job zugeordnet.
  --consistency-retries
                  Null bis fuenf zusaetzliche atomare Versuche bei Status
                  UNVOLLSTAENDIG (Gesamtversuche = 1 + dieser Wert).
  --retention-daily / --retention-monthly / --retention-yearly
                  Anzahl lokaler Generationen. Nur eindeutig identifizierte,
                  vollstaendige eigene Snapshots werden kontrolliert entfernt.
                  Ohne ausdrueckliche Werte wird nie geloescht.
  --retention-diagnostic
                  Hoechstzahl eindeutig eigener UNVOLLSTAENDIG-Snapshots.
                  0 deaktiviert deren Bereinigung; Vorgabe im App-Runner: 6.
  --capacity-warning-percent / --capacity-warning-bytes
                  Warngrenze fuer den freien Platz des Ziel-Dateisystems.
  --offsite-mode restic
                  Kopiert einen vollstaendigen lokalen Snapshot anschliessend
                  authentifiziert verschluesselt in ein restic-Repository.
                  Bei aktivem Profil scheitert der Gesamtjob geschlossen.
  --offsite-repository
                  restic-Repository; Zugangsdaten nicht in die URL schreiben.
  --offsite-password-file
                  Reguläre, geschuetzte Datei ausserhalb der Sicherungsdaten.
  --offsite-tag   Optionaler restic-Tag (Vorgabe: betreuungsbuero).
  --offsite-required yes|no
                  "yes" meldet einen Offsite-Fehler als fehlgeschlagenen
                  Gesamtjob; der neue lokale Snapshot bleibt dennoch erhalten.
  --offsite-retention-mode external
                  Remote-forget/prune wird niemals im normalen Backup-Prozess
                  ausgeführt. Eine getrennte Wartungsinstanz mit kurzlebigen
                  Löschrechten schreibt einen atomaren Statusbeleg.
  --offsite-max-pending
                  Höchstzahl noch nicht remote bestätigter Generationen.
  --offsite-check-days
                  Abstand für "restic check", die rotierende Datenlese und
                  eine Wiederherstellungsprobe.
  --offsite-read-slices
                  Anzahl rotierender Restic-Datenprüfungen. 1 liest bei jeder
                  fälligen Prüfung alle Remote-Daten; Vorgabe: 7.
  --resume-offsite-only
                  Setzt ausschließlich eine manifest-, Job-, Ziel- und
                  profilgeprüfte Offsite-Warteschlange fort. Es wird keine
                  neue lokale Generation aufgenommen.
  --resume-snapshot
                  Exakter Name des bereits lokal bestätigten Snapshots. Diese
                  Angabe ist im reinen Offsite-Retry verpflichtend; kein
                  anderer Pending-Zustand wird dabei verarbeitet.
  --allow-missing-recovery-images
                  NUR fuer leere Bootstrap-/Testsysteme: fehlende portable
                  Sicherheitsabbilder werden deutlich protokolliert, machen
                  den Snapshot ausnahmsweise aber nicht unvollstaendig.
  --expected-recovery-fingerprint
                  Oeffentlicher Fingerabdruck des aktiven Schluessels. Der
                  App-Runner setzt ihn automatisch; niemals den Schluessel selbst.
  --help          Diese Hilfe.

Rueckgabecodes:
  0  Snapshot vollstaendig und geprueft
  2  Snapshot wurde als UNVOLLSTAENDIG veroeffentlicht; PRUEFBERICHT.txt lesen
  >2 Kein Snapshot veroeffentlicht (technischer Fehler)
EOF
}

fehler() {
  printf '%s: %s\n' "$PROGRAMM" "$*" >&2
  exit 64
}

aufräumen() {
  rc=$?
  if [[ -n ${STAGE:-} && -d $STAGE ]]; then
    rm -rf -- "$STAGE"
  fi
  if [[ -n ${STAGE_OWNER:-} && -f $STAGE_OWNER && ! -L $STAGE_OWNER ]]; then
    rm -f -- "$STAGE_OWNER"
  fi
  if ((LOCK_OWNED)) && [[ -n ${LOCK_DIR:-} && -d $LOCK_DIR ]]; then
    LOCK_TOKEN_IST=
    [[ -f $LOCK_DIR/token && ! -L $LOCK_DIR/token ]] &&
      LOCK_TOKEN_IST=$(<"$LOCK_DIR/token")
    if [[ -n $LOCK_TOKEN && $LOCK_TOKEN_IST == "$LOCK_TOKEN" ]]; then
      rm -f -- "$LOCK_DIR/pid" "$LOCK_DIR/start" "$LOCK_DIR/token"
      rmdir -- "$LOCK_DIR" 2>/dev/null || true
    fi
  fi
  exit "$rc"
}
trap aufräumen EXIT HUP INT TERM

while (($#)); do
  case "$1" in
    --db)
      (($# >= 2)) || fehler "--db braucht einen Wert."
      DB_QUELLE=$2
      shift 2
      ;;
    --data-dir)
      (($# >= 2)) || fehler "--data-dir braucht einen Wert."
      DATEN_QUELLE=$2
      shift 2
      ;;
    --destination)
      (($# >= 2)) || fehler "--destination braucht einen Wert."
      ZIEL_BASIS=$2
      shift 2
      ;;
    --server-dir)
      (($# >= 2)) || fehler "--server-dir braucht einen Wert."
      SERVER_DIR=$2
      shift 2
      ;;
    --app-file)
      (($# >= 2)) || fehler "--app-file braucht einen Wert."
      APP_DATEI=$2
      shift 2
      ;;
    --label)
      (($# >= 2)) || fehler "--label braucht einen Wert."
      BEZEICHNUNG=$2
      shift 2
      ;;
    --require-marker)
      MARKER_ERFORDERLICH=1
      shift
      ;;
    --expected-target-id)
      (($# >= 2)) || fehler "--expected-target-id braucht einen Wert."
      ERWARTETE_ZIEL_ID=$2
      shift 2
      ;;
    --job-id)
      (($# >= 2)) || fehler "--job-id braucht einen Wert."
      JOB_ID=$2
      shift 2
      ;;
    --allow-missing-recovery-images)
      RECOVERY_AUSNAHME=1
      shift
      ;;
    --expected-recovery-fingerprint)
      (($# >= 2)) || fehler "--expected-recovery-fingerprint braucht einen Wert."
      ERWARTETER_RECOVERY_FP=$2
      shift 2
      ;;
    --consistency-retries)
      (($# >= 2)) || fehler "--consistency-retries braucht einen Wert."
      KONSISTENZ_WIEDERHOLUNGEN=$2
      shift 2
      ;;
    --retention-daily)
      (($# >= 2)) || fehler "--retention-daily braucht einen Wert."
      RETENTION_DAILY=$2
      shift 2
      ;;
    --retention-monthly)
      (($# >= 2)) || fehler "--retention-monthly braucht einen Wert."
      RETENTION_MONTHLY=$2
      shift 2
      ;;
    --retention-yearly)
      (($# >= 2)) || fehler "--retention-yearly braucht einen Wert."
      RETENTION_YEARLY=$2
      shift 2
      ;;
    --retention-diagnostic)
      (($# >= 2)) || fehler "--retention-diagnostic braucht einen Wert."
      RETENTION_DIAGNOSTIC=$2
      shift 2
      ;;
    --capacity-warning-percent)
      (($# >= 2)) || fehler "--capacity-warning-percent braucht einen Wert."
      KAPAZITAET_PROZENT=$2
      shift 2
      ;;
    --capacity-warning-bytes)
      (($# >= 2)) || fehler "--capacity-warning-bytes braucht einen Wert."
      KAPAZITAET_BYTES=$2
      shift 2
      ;;
    --offsite-mode)
      (($# >= 2)) || fehler "--offsite-mode braucht einen Wert."
      OFFSITE_MODE=$2
      shift 2
      ;;
    --offsite-repository)
      (($# >= 2)) || fehler "--offsite-repository braucht einen Wert."
      OFFSITE_REPOSITORY=$2
      shift 2
      ;;
    --offsite-password-file)
      (($# >= 2)) || fehler "--offsite-password-file braucht einen Wert."
      OFFSITE_PASSWORD_FILE=$2
      shift 2
      ;;
    --offsite-tag)
      (($# >= 2)) || fehler "--offsite-tag braucht einen Wert."
      OFFSITE_TAG=$2
      shift 2
      ;;
    --offsite-required)
      (($# >= 2)) || fehler "--offsite-required braucht einen Wert."
      OFFSITE_REQUIRED=$2
      shift 2
      ;;
    --offsite-retention-mode)
      (($# >= 2)) || fehler "--offsite-retention-mode braucht einen Wert."
      OFFSITE_RETENTION_MODE=$2
      shift 2
      ;;
    --offsite-max-pending)
      (($# >= 2)) || fehler "--offsite-max-pending braucht einen Wert."
      OFFSITE_MAX_PENDING=$2
      shift 2
      ;;
    --offsite-check-days)
      (($# >= 2)) || fehler "--offsite-check-days braucht einen Wert."
      OFFSITE_CHECK_DAYS=$2
      shift 2
      ;;
    --offsite-read-slices)
      (($# >= 2)) || fehler "--offsite-read-slices braucht einen Wert."
      OFFSITE_READ_SLICES=$2
      shift 2
      ;;
    --resume-offsite-only)
      RESUME_OFFSITE_ONLY=1
      shift
      ;;
    --resume-snapshot)
      (($# >= 2)) || fehler "--resume-snapshot braucht einen Wert."
      RESUME_SNAPSHOT_NAME=$2
      shift 2
      ;;
    --help|-h)
      hilfe
      exit 0
      ;;
    *)
      fehler "Unbekanntes Argument: $1"
      ;;
  esac
done

[[ -n $DB_QUELLE ]] || fehler "--db fehlt."
[[ -n $DATEN_QUELLE ]] || fehler "--data-dir fehlt."
[[ -n $ZIEL_BASIS ]] || fehler "--destination fehlt."

for ZAHL in "$RETENTION_DAILY" "$RETENTION_MONTHLY" "$RETENTION_YEARLY" \
  "$RETENTION_DIAGNOSTIC" "$KAPAZITAET_BYTES" "$OFFSITE_MAX_PENDING" \
  "$OFFSITE_CHECK_DAYS" "$OFFSITE_READ_SLICES"; do
  [[ $ZAHL =~ ^[0-9]+$ ]] || fehler "Generationen und Byte-Grenzen muessen nichtnegative ganze Zahlen sein."
done
[[ $KAPAZITAET_PROZENT =~ ^[0-9]+$ ]] ||
  fehler "--capacity-warning-percent muss eine ganze Zahl sein."
((KAPAZITAET_PROZENT >= 0 && KAPAZITAET_PROZENT <= 99)) ||
  fehler "--capacity-warning-percent muss zwischen 0 und 99 liegen."
[[ $KONSISTENZ_WIEDERHOLUNGEN =~ ^[0-5]$ ]] ||
  fehler "--consistency-retries muss zwischen 0 und 5 liegen."
[[ $JOB_ID =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$ ]] ||
  fehler "--job-id enthaelt unzulaessige Zeichen."
JOB_TOKEN=$JOB_ID
[[ -z $ERWARTETE_ZIEL_ID ||
   $ERWARTETE_ZIEL_ID =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] ||
  fehler "--expected-target-id ist keine gueltige UUID."
[[ $OFFSITE_REQUIRED == yes || $OFFSITE_REQUIRED == no ]] ||
  fehler "--offsite-required muss 'yes' oder 'no' sein."
[[ $OFFSITE_RETENTION_MODE == external ]] ||
  fehler "--offsite-retention-mode unterstützt ausschließlich 'external'; der Backup-Prozess erhält keine Löschrechte."
((OFFSITE_MAX_PENDING >= 1 && OFFSITE_MAX_PENDING <= 365)) ||
  fehler "--offsite-max-pending muss zwischen 1 und 365 liegen."
((OFFSITE_CHECK_DAYS >= 1 && OFFSITE_CHECK_DAYS <= 365)) ||
  fehler "--offsite-check-days muss zwischen 1 und 365 liegen."
((OFFSITE_READ_SLICES >= 1 && OFFSITE_READ_SLICES <= 64)) ||
  fehler "--offsite-read-slices muss zwischen 1 und 64 liegen."
if [[ -n $ERWARTETER_RECOVERY_FP && ! $ERWARTETER_RECOVERY_FP =~ ^[0-9a-fA-F]{24}$ ]]; then
  fehler "--expected-recovery-fingerprint muss aus genau 24 Hex-Zeichen bestehen."
fi
[[ $OFFSITE_MODE == none || $OFFSITE_MODE == restic ]] ||
  fehler "--offsite-mode unterstuetzt nur 'restic'."
if [[ $OFFSITE_MODE == restic ]]; then
  [[ -n $OFFSITE_REPOSITORY ]] || fehler "Aktives restic-Offsiteprofil braucht --offsite-repository."
  [[ -n $OFFSITE_PASSWORD_FILE ]] || fehler "Aktives restic-Offsiteprofil braucht --offsite-password-file."
  [[ $OFFSITE_TAG =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] ||
    fehler "--offsite-tag enthaelt unzulaessige Zeichen."
  ((${#OFFSITE_REPOSITORY} <= 2048)) &&
    [[ $OFFSITE_REPOSITORY != *$'\n'* && $OFFSITE_REPOSITORY != *$'\r'* &&
       $OFFSITE_REPOSITORY != *$'\t'* ]] ||
    fehler "--offsite-repository enthaelt unzulaessige Steuerzeichen oder ist zu lang."
  [[ $OFFSITE_REPOSITORY =~ ^(s3|sftp|rest|rclone|azure|gs|b2|swift): ]] ||
    fehler "Offsite verlangt ein echtes Remote-restic-Repository (s3:, sftp:, rest:, rclone:, azure:, gs:, b2: oder swift:); lokale/NAS-Dateipfade sind nicht zulaessig."
  [[ ! $OFFSITE_REPOSITORY =~ ://[^/@:]+:[^/@]+@ ]] ||
    fehler "Zugangsdaten duerfen nicht im Offsite-Repository-URL stehen; restic-Umgebungsvariablen/Provider-Credentials verwenden."
fi
if ((RESUME_OFFSITE_ONLY)) && [[ $OFFSITE_MODE != restic ]]; then
  fehler "--resume-offsite-only braucht ein aktives restic-Offsiteprofil."
fi
if [[ -n $RESUME_SNAPSHOT_NAME ]] && (( ! RESUME_OFFSITE_ONLY )); then
  fehler "--resume-snapshot ist nur zusammen mit --resume-offsite-only zulaessig."
fi
if ((RESUME_OFFSITE_ONLY)) &&
   [[ ! $RESUME_SNAPSHOT_NAME =~ ^Gesamtsicherung_[0-9]{8}_[0-9]{6}(_[[:alnum:]_.-]+)?$ ]]; then
  fehler "--resume-offsite-only braucht einen gueltigen exakten --resume-snapshot-Namen."
fi

for werkzeug in sqlite3 tar find wc od tr date mktemp mv cp cmp awk sed cut head \
  df du grep sort rm sync uname stat ps node env dirname cat mkdir rmdir chmod; do
  command -v "$werkzeug" >/dev/null 2>&1 || fehler "Benoetigtes Werkzeug fehlt: $werkzeug"
done
if [[ $OFFSITE_MODE == restic ]]; then
  RESTIC_BIN=$(command -v restic 2>/dev/null || true)
  [[ -n $RESTIC_BIN ]] || fehler "Aktives Offsiteprofil braucht das Werkzeug restic."
  ENV_BIN=$(command -v env 2>/dev/null || true)
  [[ -n $ENV_BIN ]] || fehler "Aktives Offsiteprofil braucht das Werkzeug env."
fi

if command -v shasum >/dev/null 2>&1; then
  SHA_ART=shasum
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_ART=sha256sum
else
  fehler "Weder shasum noch sha256sum ist vorhanden."
fi

command -v base64 >/dev/null 2>&1 || fehler "Benoetigtes Werkzeug fehlt: base64"
if printf 'Zg==' | base64 -d >/dev/null 2>&1; then
  B64_FLAG=-d
elif printf 'Zg==' | base64 -D >/dev/null 2>&1; then
  B64_FLAG=-D
else
  fehler "base64 kann nicht zum Dekodieren aufgerufen werden."
fi

enthaelt_steuerzeichen() {
  case "$1" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 0 ;;
    *) return 1 ;;
  esac
}

# Eine atomare Umbenennung macht einen Zustand nur logisch sichtbar. Erst ein
# erfolgreicher Flush bestätigt, dass Snapshot/Sidecar auch einen Stromausfall
# überstehen. GNU sync kann gezielt Pfade synchronisieren; auf Systemen ohne
# diese Erweiterung fällt der zweite Aufruf auf den globalen POSIX-Flush zurück.
# Schlagen beide Varianten fehl, darf der Lauf niemals Erfolg melden.
dauerhaft_synchronisieren() {
  if (($#)) && sync "$@" 2>/dev/null; then
    return 0
  fi
  sync 2>/dev/null
}

for p in "$DB_QUELLE" "$DATEN_QUELLE" "$ZIEL_BASIS" "$SERVER_DIR" "$APP_DATEI" "$OFFSITE_PASSWORD_FILE"; do
  [[ -n $p ]] || continue
  enthaelt_steuerzeichen "$p" && fehler "Pfade mit Tabulator oder Zeilenumbruch sind nicht zulaessig."
done
enthaelt_steuerzeichen "$OFFSITE_REPOSITORY" &&
  fehler "Das Offsite-Repository enthaelt Tabulator oder Zeilenumbruch."

if (( ! RESUME_OFFSITE_ONLY )); then
  [[ -f $DB_QUELLE && ! -L $DB_QUELLE ]] || fehler "Datenbank ist keine regulaere Datei: $DB_QUELLE"
  [[ -d $DATEN_QUELLE ]] || fehler "Datenverzeichnis fehlt: $DATEN_QUELLE"
  [[ -d $SERVER_DIR ]] || fehler "Server-Verzeichnis fehlt: $SERVER_DIR"
  if [[ -n $APP_DATEI ]]; then
    [[ -f $APP_DATEI && ! -L $APP_DATEI ]] || fehler "App-Datei ist keine regulaere Datei: $APP_DATEI"
  fi
fi
if [[ $OFFSITE_MODE == restic ]]; then
  [[ -f $OFFSITE_PASSWORD_FILE && ! -L $OFFSITE_PASSWORD_FILE ]] ||
    fehler "restic-Passwortdatei ist keine regulaere Datei: $OFFSITE_PASSWORD_FILE"
  if [[ $(uname -s 2>/dev/null || true) != *MINGW* ]]; then
    OFFSITE_MODUS=$(stat -f '%Lp' "$OFFSITE_PASSWORD_FILE" 2>/dev/null ||
      stat -c '%a' "$OFFSITE_PASSWORD_FILE" 2>/dev/null || printf '777')
    [[ $OFFSITE_MODUS == 600 || $OFFSITE_MODUS == 0600 ]] ||
      fehler "restic-Passwortdatei muss exakt mit Modus 0600 geschuetzt sein."
  fi
fi
zielmarker_laden() {
  local marker=$1 text id anzahl
  [[ -f $marker && ! -L $marker ]] || return 1
  text=$(<"$marker")
  [[ -n ${text//[[:space:]]/} ]] || return 1
  [[ $(printf '%s\n' "$text" | sed -n '1p') == Betreuungsbuero-Backupziel/1 ]] ||
    return 1
  anzahl=$(printf '%s\n' "$text" | grep -c '^TARGET_ID=' || true)
  ((anzahl == 1)) || return 1
  id=$(printf '%s\n' "$text" | sed -n 's/^TARGET_ID=//p')
  [[ $id =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] ||
    return 1
  ZIEL_ID=$(printf '%s' "$id" | tr 'A-F' 'a-f')
  return 0
}

if ((MARKER_ERFORDERLICH)); then
  [[ -d $ZIEL_BASIS ]] ||
    fehler "Markiertes Sicherungsziel ist nicht eingehangen oder fehlt: $ZIEL_BASIS"
  zielmarker_laden "$ZIEL_BASIS/.betreuungsbuero-backup-ziel" ||
    fehler "Zielmarke fehlt, ist ungueltig oder nicht eindeutig; das Sicherungsziel muss zuerst ausdruecklich im Adminbereich initialisiert werden: $ZIEL_BASIS/.betreuungsbuero-backup-ziel"
  if [[ -n $ERWARTETE_ZIEL_ID &&
        $(printf '%s' "$ERWARTETE_ZIEL_ID" | tr 'A-F' 'a-f') != "$ZIEL_ID" ]]; then
    fehler "Falscher Sicherungsdatentraeger: TARGET_ID der Zielmarke stimmt nicht mit dem Zeitplan ueberein."
  fi
else
  mkdir -p -- "$ZIEL_BASIS"
fi
[[ -d $ZIEL_BASIS ]] || fehler "Zielverzeichnis konnte nicht angelegt werden: $ZIEL_BASIS"

kanon_datei() {
  local d b
  d=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd -P)
  b=${1##*/}
  printf '%s/%s\n' "$d" "$b"
}

kanon_ordner() {
  (CDPATH= cd -- "$1" && pwd -P)
}

dateisystem_id() {
  stat -f '%d' "$1" 2>/dev/null || stat -c '%d' "$1" 2>/dev/null || return 1
}

ZIEL_BASIS=$(kanon_ordner "$ZIEL_BASIS")
ZIEL_BASIS_KANON=$ZIEL_BASIS
if [[ -n $OFFSITE_PASSWORD_FILE ]]; then OFFSITE_PASSWORD_FILE=$(kanon_datei "$OFFSITE_PASSWORD_FILE"); fi
QUELL_DEVICE=
if (( ! RESUME_OFFSITE_ONLY )); then
  DB_QUELLE=$(kanon_datei "$DB_QUELLE")
  DATEN_QUELLE=$(kanon_ordner "$DATEN_QUELLE")
  SERVER_DIR=$(kanon_ordner "$SERVER_DIR")
  RUNTIME_DIR=$(dirname -- "$DATEN_QUELLE")
  TEMPLATES_DIR=$SERVER_DIR/assets/templates
  EXTENSION_ARTIFACTS_DIR=$RUNTIME_DIR/extension-artifacts
  OCR_ASSETS_DIR=$SERVER_DIR/assets/ocr
  if [[ -n $APP_DATEI ]]; then APP_DATEI=$(kanon_datei "$APP_DATEI"); fi
  QUELL_DEVICE=$(dateisystem_id "$DATEN_QUELLE" || true)
fi
ZIEL_DEVICE=$(dateisystem_id "$ZIEL_BASIS" || true)
[[ -n $ZIEL_DEVICE ]] ||
  fehler "Dateisystemkennung des Sicherungsziels konnte vor dem Lauf nicht bestimmt werden."

ist_unterhalb() {
  local kind=$1 eltern=$2
  [[ $kind == "$eltern" || $kind == "$eltern/"* ]]
}

if (( ! RESUME_OFFSITE_ONLY )); then
  ist_unterhalb "$ZIEL_BASIS" "$DATEN_QUELLE" &&
    fehler "Das Sicherungsziel darf nicht im zu sichernden Datenverzeichnis liegen."
  ist_unterhalb "$DATEN_QUELLE" "$ZIEL_BASIS" &&
    fehler "Das Sicherungsziel darf kein uebergeordneter Ordner des Datenverzeichnisses sein."
  ist_unterhalb "$ZIEL_BASIS" "$SERVER_DIR" &&
    fehler "Das Sicherungsziel darf nicht im Server-/Projektbaum liegen."
  ist_unterhalb "$SERVER_DIR" "$DATEN_QUELLE" &&
    fehler "--data-dir darf nicht den Server-/Projektbaum umfassen; sonst koennten .env oder Laufzeit-Secret-Dateien in die Sicherung geraten."
  ist_unterhalb "$SERVER_DIR" "$ZIEL_BASIS" &&
    fehler "Das Sicherungsziel darf kein uebergeordneter Ordner des Server-/Projektbaums sein."
fi
if [[ -n $OFFSITE_PASSWORD_FILE ]]; then
  if (( ! RESUME_OFFSITE_ONLY )); then
    ist_unterhalb "$OFFSITE_PASSWORD_FILE" "$DATEN_QUELLE" &&
      fehler "Die restic-Passwortdatei darf nicht in der zu sichernden Datenwurzel liegen."
    ist_unterhalb "$OFFSITE_PASSWORD_FILE" "$SERVER_DIR" &&
      fehler "Die restic-Passwortdatei darf nicht im Server-/Projektbaum liegen."
  fi
  ist_unterhalb "$OFFSITE_PASSWORD_FILE" "$ZIEL_BASIS" &&
    fehler "Die restic-Passwortdatei darf nicht im lokalen Sicherungsziel liegen."
fi

# lstat/stat vor dem Lauf allein lässt ein Austauschfenster bis zum späteren
# restic-Aufruf offen. Deshalb öffnet jede Restic-Operation das Secret
# unmittelbar vorher mit O_NOFOLLOW, prüft den geöffneten Deskriptor und
# vergleicht ihn erneut mit dem Pfad. Ein verbleibender Austausch zwischen
# dieser Prüfung und dem exec ist damit auf wenige Instruktionen begrenzt.
offsite_passwort_pruefen() {
  [[ $OFFSITE_MODE == restic ]] || return 0
  node - "$OFFSITE_PASSWORD_FILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
let fd;
try {
  fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const opened = fs.fstatSync(fd);
  const named = fs.lstatSync(file);
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() ||
      opened.dev !== named.dev || opened.ino !== named.ino) {
    throw new Error('Pfad und geoeffnete Passwortdatei sind nicht dieselbe regulaere Datei');
  }
  if (process.platform !== 'win32' && (opened.mode & 0o777) !== 0o600) {
    throw new Error('Modus ist nicht exakt 0600');
  }
  if (opened.size < 1 || opened.size > 65536) {
    throw new Error('Dateigroesse liegt nicht zwischen 1 und 65536 Bytes');
  }
} catch (error) {
  console.error(`Unsichere restic-Passwortdatei: ${error.message}`);
  process.exit(77);
} finally {
  if (fd !== undefined) fs.closeSync(fd);
}
NODE
}

restic_sicher() {
  local name wert
  local -a saubere_umgebung=()
  local -a erlaubte_variablen=(
    PATH HOME USER LOGNAME SHELL TMPDIR TMP TEMP
    LANG LANGUAGE LC_ALL LC_CTYPE LC_MESSAGES LC_TIME LC_NUMERIC LC_COLLATE
    LC_MONETARY LC_PAPER LC_NAME LC_ADDRESS LC_TELEPHONE LC_MEASUREMENT
    LC_IDENTIFICATION TZ SSL_CERT_FILE SSL_CERT_DIR
    HTTPS_PROXY HTTP_PROXY ALL_PROXY NO_PROXY
    https_proxy http_proxy all_proxy no_proxy
    SSH_AUTH_SOCK SSH_AGENT_PID
    SystemRoot WINDIR ComSpec PATHEXT
    RESTIC_CACHE_DIR RESTIC_COMPRESSION RESTIC_PACK_SIZE
    AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
    AWS_DEFAULT_REGION AWS_REGION AWS_PROFILE
    AWS_SHARED_CREDENTIALS_FILE AWS_CONFIG_FILE
    RESTIC_REST_USERNAME RESTIC_REST_PASSWORD
    B2_ACCOUNT_ID B2_ACCOUNT_KEY
    AZURE_ACCOUNT_NAME AZURE_ACCOUNT_KEY
    GOOGLE_PROJECT_ID GOOGLE_APPLICATION_CREDENTIALS
    RCLONE_CONFIG
    OS_AUTH_URL OS_USERNAME OS_USER_ID OS_PASSWORD
    OS_REGION_NAME OS_TENANT_ID OS_TENANT_NAME
    OS_PROJECT_ID OS_PROJECT_NAME
    OS_APPLICATION_CREDENTIAL_ID OS_APPLICATION_CREDENTIAL_SECRET
    OS_USER_DOMAIN_NAME OS_PROJECT_DOMAIN_NAME
    OS_TRUST_ID OS_STORAGE_URL OS_AUTH_TOKEN
  )
  offsite_passwort_pruefen || return 77
  for name in "${erlaubte_variablen[@]}"; do
    wert=${!name-}
    [[ -n $wert && ${#wert} -le 8192 &&
       $wert != *$'\n'* && $wert != *$'\r'* ]] || continue
    saubere_umgebung+=("$name=$wert")
  done
  # App-Secrets wie SESSION_SECRET, ENCRYPTION_KEY, DOCUMENT_RECOVERY_KEY und
  # SETUP_TOKEN sind nicht Teil dieser Positivliste. Sie erreichen damit keinen
  # Restic-Unterprozess, obwohl der lokale Sicherungslauf sie für eigene
  # Prüfungen benötigen kann.
  "$ENV_BIN" -i "${saubere_umgebung[@]}" "$RESTIC_BIN" "$@"
}

prozess_startkennung() {
  ps -p "$1" -o lstart= 2>/dev/null | awk '{$1=$1; print}'
}

schreibe_lock_besitzer() {
  local ordner=$1 token=$2 start
  start=$(prozess_startkennung "$$")
  printf '%s\n' "$$" > "$ordner/pid"
  printf '%s\n' "$start" > "$ordner/start"
  printf '%s\n' "$token" > "$ordner/token"
}

lock_besitzer_lebt() {
  local ordner=$1 pid start jetzt
  [[ -f $ordner/pid && ! -L $ordner/pid &&
     -f $ordner/start && ! -L $ordner/start ]] || return 1
  pid=$(<"$ordner/pid")
  start=$(<"$ordner/start")
  [[ $pid =~ ^[1-9][0-9]*$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  jetzt=$(prozess_startkennung "$pid")
  # Falls ps die Startzeit vorübergehend nicht liefert, wird eine erreichbare
  # PID konservativ niemals übernommen.
  [[ -z $jetzt || -z $start || $jetzt == "$start" ]]
}

lock_metadaten_vollstaendig() {
  local ordner=$1 pid start token
  [[ -f $ordner/pid && ! -L $ordner/pid &&
     -f $ordner/start && ! -L $ordner/start &&
     -f $ordner/token && ! -L $ordner/token ]] || return 1
  pid=$(<"$ordner/pid")
  start=$(<"$ordner/start")
  token=$(<"$ordner/token")
  [[ $pid =~ ^[1-9][0-9]*$ && -n $start && -n $token ]]
}

lock_initialisierung_jung() {
  local ordner=$1 mtime jetzt alter
  if [[ $(uname -s 2>/dev/null || true) == Darwin ]]; then
    mtime=$(stat -f '%m' "$ordner" 2>/dev/null || true)
  else
    mtime=$(stat -c '%Y' "$ordner" 2>/dev/null || true)
  fi
  [[ $mtime =~ ^[0-9]+$ ]] || return 0
  jetzt=$(date +%s)
  alter=$((jetzt - mtime))
  # Das sehr kurze Fenster zwischen mkdir und den drei Owner-Dateien wird
  # konservativ geschützt. Ein nach SIGKILL unvollständiges Lock bleibt nach
  # 30 Sekunden dennoch automatisch heilbar.
  ((alter < 30))
}

LOCK_DIR=$ZIEL_BASIS/.gesamt-backup.lock
LOCK_TOKEN="$$-$(date +%s)-${RANDOM:-0}-${RANDOM:-0}"
if mkdir -- "$LOCK_DIR" 2>/dev/null; then
  schreibe_lock_besitzer "$LOCK_DIR" "$LOCK_TOKEN"
  LOCK_OWNED=1
else
  # Nur ein Prozess darf eine nachweislich tote Sperre untersuchen und
  # atomar aus dem festen Namen verschieben. Dadurch kann kein zweiter
  # Reclaimer versehentlich eine inzwischen neu angelegte, lebende Sperre
  # übernehmen.
  if ! lock_metadaten_vollstaendig "$LOCK_DIR" &&
     lock_initialisierung_jung "$LOCK_DIR"; then
    fehler "Eine Sicherung initialisiert gerade ihre Sperre; der unvollstaendige Owner wird noch nicht uebernommen."
  fi
  RECLAIM_DIR=$LOCK_DIR/.reclaim
  RECLAIM_TOKEN="reclaim-$LOCK_TOKEN"
  if ! mkdir -- "$RECLAIM_DIR" 2>/dev/null; then
    if lock_besitzer_lebt "$RECLAIM_DIR"; then
      fehler "Es laeuft bereits eine Sicherung oder Sperrpruefung (Sperre: $LOCK_DIR)."
    fi
    if ! lock_metadaten_vollstaendig "$RECLAIM_DIR" &&
       lock_initialisierung_jung "$RECLAIM_DIR"; then
      fehler "Eine Sperrpruefung initialisiert gerade ihren Owner; sie wird noch nicht uebernommen."
    fi
    # Auch der sehr kurze Reclaim-Schritt kann durch SIGKILL verwaisen. Das
    # gesamte alte Lock wird dann mit Node/fs.rename atomar in einen eindeutigen
    # Tombstone verschoben. Anders als `mv` verschiebt renameSync eine neue
    # Sperre bei einem Rennen niemals in einen schon vorhandenen Zielordner.
    ALTER_RECLAIM_TOKEN=
    [[ -f $RECLAIM_DIR/token && ! -L $RECLAIM_DIR/token ]] &&
      ALTER_RECLAIM_TOKEN=$(<"$RECLAIM_DIR/token")
    ALTER_RECLAIM_TOKEN=$(printf '%s' "${ALTER_RECLAIM_TOKEN:-unvollstaendig}" |
      tr -cs '[:alnum:]_.-' '_' | cut -c1-80)
    if lock_besitzer_lebt "$LOCK_DIR"; then
      STALE_RECLAIM=$LOCK_DIR/.reclaim.stale-"$ALTER_RECLAIM_TOKEN"
      if ! node -e \
        'require("fs").renameSync(process.argv[1], process.argv[2])' \
        "$RECLAIM_DIR" "$STALE_RECLAIM" 2>/dev/null; then
        fehler "Eine andere Sperrpruefung hat den verwaisten Reclaim bereits uebernommen."
      fi
      rm -f -- "$STALE_RECLAIM/pid" "$STALE_RECLAIM/start" "$STALE_RECLAIM/token"
      rmdir -- "$STALE_RECLAIM" 2>/dev/null || true
      fehler "Es laeuft bereits eine Sicherung; nur ihr verwaister Reclaim wurde entfernt."
    fi
    STALE_LOCK=$ZIEL_BASIS/.gesamt-backup.lock.stale-reclaim-"$ALTER_RECLAIM_TOKEN"
    if ! node -e \
      'require("fs").renameSync(process.argv[1], process.argv[2])' \
      "$LOCK_DIR" "$STALE_LOCK" 2>/dev/null; then
      fehler "Eine andere Sicherung hat die verwaiste Sperrpruefung bereits uebernommen."
    fi
    rm -f -- "$STALE_LOCK/pid" "$STALE_LOCK/start" "$STALE_LOCK/token" \
      "$STALE_LOCK/.reclaim/pid" "$STALE_LOCK/.reclaim/start" "$STALE_LOCK/.reclaim/token"
    rmdir -- "$STALE_LOCK/.reclaim" 2>/dev/null || true
    rmdir -- "$STALE_LOCK" 2>/dev/null || true
    if ! mkdir -- "$LOCK_DIR" 2>/dev/null; then
      fehler "Eine andere Sicherung hat die freigegebene Sperre zuerst uebernommen."
    fi
    schreibe_lock_besitzer "$LOCK_DIR" "$LOCK_TOKEN"
    LOCK_OWNED=1
    RECLAIM_DIR=
  fi
  if [[ -n ${RECLAIM_DIR:-} ]]; then
    schreibe_lock_besitzer "$RECLAIM_DIR" "$RECLAIM_TOKEN"
    if lock_besitzer_lebt "$LOCK_DIR"; then
      rm -f -- "$RECLAIM_DIR/pid" "$RECLAIM_DIR/start" "$RECLAIM_DIR/token"
      rmdir -- "$RECLAIM_DIR" 2>/dev/null || true
      fehler "Es laeuft bereits eine Sicherung (Sperre: $LOCK_DIR)."
    fi

    STALE_LOCK=$ZIEL_BASIS/.gesamt-backup.lock.stale-"$LOCK_TOKEN"
    if ! node -e \
      'require("fs").renameSync(process.argv[1], process.argv[2])' \
      "$LOCK_DIR" "$STALE_LOCK" 2>/dev/null; then
      fehler "Veraltete Sicherungssperre konnte nicht atomar zurueckgefordert werden."
    fi
    rm -f -- "$STALE_LOCK/pid" "$STALE_LOCK/start" "$STALE_LOCK/token" \
      "$STALE_LOCK/.reclaim/pid" "$STALE_LOCK/.reclaim/start" "$STALE_LOCK/.reclaim/token"
    rmdir -- "$STALE_LOCK/.reclaim" 2>/dev/null || true
    rmdir -- "$STALE_LOCK" 2>/dev/null || true

    if ! mkdir -- "$LOCK_DIR" 2>/dev/null; then
      fehler "Eine andere Sicherung hat die freigegebene Sperre zuerst uebernommen."
    fi
    schreibe_lock_besitzer "$LOCK_DIR" "$LOCK_TOKEN"
    LOCK_OWNED=1
  fi
fi

log_rotiere() {
  local log=$1 max_bytes=$2 generationen=$3 size i
  [[ -f $log && ! -L $log ]] || return 0
  size=$(wc -c < "$log" | tr -d ' ')
  [[ $size =~ ^[0-9]+$ ]] || return 0
  ((size > max_bytes)) || return 0
  i=$generationen
  rm -f -- "$log.$i"
  while ((i > 1)); do
    [[ ! -f $log.$((i - 1)) || -L $log.$((i - 1)) ]] ||
      mv -- "$log.$((i - 1))" "$log.$i"
    i=$((i - 1))
  done
  mv -- "$log" "$log.1"
}

log_rotiere "$ZIEL_BASIS/backup-maintenance.log" 1048576 5
log_rotiere "$ZIEL_BASIS/scheduler.log" 2097152 3

bereinige_verwaiste_stages() {
  local owner basis stage_name stage tomb format zeilen marker bereinigt=0
  for owner in "$ZIEL_BASIS"/.gesamt-backup-stage-*.owner; do
    ((bereinigt < 32)) || break
    [[ -f $owner && ! -L $owner ]] || continue
    basis=${owner##*/}
    [[ $basis =~ ^\.gesamt-backup-stage-[0-9]+-[0-9]+-[0-9]+-[0-9]+\.owner$ ]] ||
      continue
    zeilen=$(wc -l < "$owner" | tr -d ' ')
    format=$(sed -n '1p' "$owner")
    stage_name=$(sed -n '2s/^STAGE=//p' "$owner")
    [[ $zeilen == 2 &&
       $format == Betreuungsbuero-Gesamtsicherung-Stage/1 &&
       $stage_name == "${basis%.owner}" ]] || continue
    stage=$ZIEL_BASIS/$stage_name
    if [[ -e $stage ]]; then
      [[ -d $stage && ! -L $stage ]] || continue
      [[ $(kanon_ordner "$(dirname -- "$stage")") == "$ZIEL_BASIS" ]] || continue
      tomb=$ZIEL_BASIS/.stage-delete-${stage_name#".gesamt-backup-stage-"}-$LOCK_TOKEN
      [[ ! -e $tomb ]] || continue
      mv -- "$stage" "$tomb"
      rm -rf -- "$tomb"
    fi
    rm -f -- "$owner"
    bereinigt=$((bereinigt + 1))
    printf '%s Verwaiste eigene Arbeitsstufe entfernt: %s\n' \
      "$(date '+%Y-%m-%d %H:%M:%S %z')" "$stage_name" \
      >> "$ZIEL_BASIS/backup-maintenance.log"
  done
  # Übergangsformat früherer Fassungen: Auch hier ist nur der von uns
  # geschriebene innere Formatmarker eine Löschberechtigung. Gleich benannte
  # fremde/veraltete Ordner ohne Marker bleiben unangetastet.
  for stage in "$ZIEL_BASIS"/.gesamt-backup.????????; do
    ((bereinigt < 32)) || break
    [[ -d $stage && ! -L $stage ]] || continue
    stage_name=${stage##*/}
    [[ $stage_name =~ ^\.gesamt-backup\.[[:alnum:]]{8}$ ]] || continue
    marker=$stage/verwaltung/SNAPSHOT-FORMAT.txt
    [[ -f $marker && ! -L $marker &&
       $(<"$marker") == Betreuungsbuero-Gesamtsicherung/1 ]] || continue
    tomb=$ZIEL_BASIS/.stage-delete-${stage_name#".gesamt-backup."}-$LOCK_TOKEN
    [[ ! -e $tomb ]] || continue
    mv -- "$stage" "$tomb"
    rm -rf -- "$tomb"
    bereinigt=$((bereinigt + 1))
    printf '%s Verwaiste eigene Legacy-Arbeitsstufe entfernt: %s\n' \
      "$(date '+%Y-%m-%d %H:%M:%S %z')" "$stage_name" \
      >> "$ZIEL_BASIS/backup-maintenance.log"
  done
  ((bereinigt == 0)) ||
    printf 'STAGE_BEREINIGUNG=OK ENTFERNT=%d\n' "$bereinigt"
}

bereinige_retention_tombstones() {
  local owner owner_name tomb_name snapshot_name target_id tomb bereinigt=0
  for owner in "$ZIEL_BASIS"/.retention-delete-*.owner; do
    ((bereinigt < 32)) || break
    [[ -f $owner && ! -L $owner ]] || continue
    owner_name=${owner##*/}
    [[ $owner_name =~ ^\.retention-delete-Gesamtsicherung_[0-9]{8}_[0-9]{6}(_[[:alnum:]_.-]+)?-[0-9a-f]{32}\.owner$ ]] ||
      continue
    [[ $(wc -l < "$owner" | tr -d ' ') -eq 4 ]] || {
      printf 'WARNUNG=RETENTION_TOMBSTONE_OWNER_UNGUELTIG DATEI=%s\n' "$owner_name" >&2
      continue
    }
    [[ $(sed -n '1p' "$owner") == Betreuungsbuero-Retention-Tombstone/1 ]] || {
      printf 'WARNUNG=RETENTION_TOMBSTONE_OWNER_UNGUELTIG DATEI=%s\n' "$owner_name" >&2
      continue
    }
    tomb_name=$(sed -n '2s/^TOMB=//p' "$owner")
    snapshot_name=$(sed -n '3s/^SNAPSHOT=//p' "$owner")
    target_id=$(sed -n '4s/^TARGET_ID=//p' "$owner")
    [[ $tomb_name == "${owner_name%.owner}" &&
       $snapshot_name =~ ^Gesamtsicherung_[0-9]{8}_[0-9]{6}(_[[:alnum:]_.-]+)?$ &&
       $tomb_name == ".retention-delete-${snapshot_name}-"* &&
       $target_id == "${ZIEL_ID:-unmarkiert}" ]] || {
      printf 'WARNUNG=RETENTION_TOMBSTONE_OWNER_UNGUELTIG DATEI=%s\n' "$owner_name" >&2
      continue
    }
    tomb=$ZIEL_BASIS/$tomb_name
    if [[ -e $tomb ]]; then
      [[ -d $tomb && ! -L $tomb &&
         $(kanon_ordner "$(dirname -- "$tomb")") == "$ZIEL_BASIS" ]] || {
        printf 'WARNUNG=RETENTION_TOMBSTONE_UNSICHER DATEI=%s\n' "$tomb_name" >&2
        continue
      }
      rm -rf -- "$tomb"
    fi
    rm -f -- "$ZIEL_BASIS/${snapshot_name}.offsite-status" \
      "$ZIEL_BASIS/${snapshot_name}.offsite.log" \
      "$ZIEL_BASIS/${snapshot_name}.offsite-abandoned"
    rm -f -- "$owner"
    dauerhaft_synchronisieren "$ZIEL_BASIS" ||
      fehler "Bereinigter Retention-Tombstone konnte nicht dauerhaft synchronisiert werden."
    bereinigt=$((bereinigt + 1))
  done
  ((bereinigt == 0)) ||
    printf 'RETENTION_TOMBSTONE_BEREINIGUNG=OK ENTFERNT=%d\n' "$bereinigt"
}

# Die Sidecar-Kennung wird vor dem Arbeitsverzeichnis atomar veröffentlicht.
# Bei SIGKILL existiert daher entweder noch kein Stage-Verzeichnis oder ein
# eindeutig eigenes, das ein späterer exklusiver Lauf kontrolliert entfernen kann.
if (( ! RESUME_OFFSITE_ONLY )); then
  bereinige_verwaiste_stages
  bereinige_retention_tombstones
fi

zielmarker_id_nur_lesen() {
  local marker=$1 text id anzahl
  [[ -f $marker && ! -L $marker ]] || return 1
  text=$(<"$marker")
  [[ $(printf '%s\n' "$text" | sed -n '1p') == Betreuungsbuero-Backupziel/1 ]] ||
    return 1
  anzahl=$(printf '%s\n' "$text" | grep -c '^TARGET_ID=' || true)
  ((anzahl == 1)) || return 1
  id=$(printf '%s\n' "$text" | sed -n 's/^TARGET_ID=//p')
  [[ $id =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] ||
    return 1
  printf '%s\n' "$id" | tr 'A-F' 'a-f'
}

ziel_vor_veroeffentlichung_pruefen() {
  local ziel_kanon_jetzt ziel_device_jetzt ziel_id_jetzt erwartete_id
  [[ -d $ZIEL_BASIS && ! -L $ZIEL_BASIS ]] ||
    fehler "Sicherungsziel ist unmittelbar vor der Veroeffentlichung nicht mehr als regulaerer Ordner erreichbar."
  ziel_kanon_jetzt=$(kanon_ordner "$ZIEL_BASIS" 2>/dev/null) ||
    fehler "Sicherungsziel konnte unmittelbar vor der Veroeffentlichung nicht kanonisch aufgeloest werden."
  [[ $ziel_kanon_jetzt == "$ZIEL_BASIS_KANON" ]] ||
    fehler "Sicherungsziel wurde waehrend des Laufs ausgetauscht (kanonischer Pfad geaendert)."
  ziel_device_jetzt=$(dateisystem_id "$ZIEL_BASIS" 2>/dev/null) ||
    fehler "Dateisystemkennung des Sicherungsziels ist unmittelbar vor der Veroeffentlichung nicht lesbar."
  [[ -n $ziel_device_jetzt && $ziel_device_jetzt == "$ZIEL_DEVICE" ]] ||
    fehler "Sicherungsziel wurde waehrend des Laufs ausgetauscht oder ausgehaengt (Device geaendert)."
  if ((MARKER_ERFORDERLICH)); then
    ziel_id_jetzt=$(zielmarker_id_nur_lesen "$ZIEL_BASIS/.betreuungsbuero-backup-ziel") ||
      fehler "Zielmarke ist unmittelbar vor der Veroeffentlichung nicht mehr gueltig."
    [[ $ziel_id_jetzt == "$ZIEL_ID" ]] ||
      fehler "Sicherungsziel wurde waehrend des Laufs ausgetauscht (TARGET_ID geaendert)."
    if [[ -n $ERWARTETE_ZIEL_ID ]]; then
      erwartete_id=$(printf '%s' "$ERWARTETE_ZIEL_ID" | tr 'A-F' 'a-f')
      [[ $ziel_id_jetzt == "$erwartete_id" ]] ||
        fehler "Falscher Sicherungsdatentraeger unmittelbar vor der Veroeffentlichung."
    fi
  fi
}

sha_datei() {
  if [[ $SHA_ART == shasum ]]; then
    shasum -a 256 -- "$1" | awk '{print $1}'
  else
    sha256sum -- "$1" | awk '{print $1}'
  fi
}

sha_stdin() {
  if [[ $SHA_ART == shasum ]]; then
    shasum -a 256 | awk '{print $1}'
  else
    sha256sum | awk '{print $1}'
  fi
}

if (( ! RESUME_OFFSITE_ONLY )); then
# Vor dem ersten großen Schreibvorgang muss neben der konfigurierten Reserve
# mindestens der aktuell bekannte Quellumfang verfügbar sein. Die spätere
# Kontrolle bleibt bestehen, weil externe Dokumentwurzeln erst aus der
# konsistenten DB-Kopie vollständig bekannt werden.
QUELLE_KB=$(du -sk "$DATEN_QUELLE" | awk '{print $1}')
[[ $QUELLE_KB =~ ^[0-9]+$ ]] || fehler "Quellumfang fuer den Kapazitaets-Preflight konnte nicht bestimmt werden."
DB_BYTES=$(wc -c < "$DB_QUELLE" | tr -d ' ')
APP_BYTES=0
if [[ -n $APP_DATEI ]]; then APP_BYTES=$(wc -c < "$APP_DATEI" | tr -d ' '); fi
QUELLE_BYTES=$((QUELLE_KB * 1024 + DB_BYTES + APP_BYTES))
# 10 % Arbeitsmarge, mindestens 64 MiB für Manifest, Quellarchiv und atomare
# Zwischenstände.
MARGE_BYTES=$((QUELLE_BYTES / 10))
((MARGE_BYTES >= 67108864)) || MARGE_BYTES=67108864
DF_PREFLIGHT=$(df -Pk "$ZIEL_BASIS" | awk 'END {
  gsub(/%/,"",$5);
  if ($2 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ && $5 ~ /^[0-9]+$/)
    print $2 "|" $4 "|" (100-$5)
}')
[[ -n $DF_PREFLIGHT ]] || fehler "Freier Platz des Sicherungsziels konnte vor dem Lauf nicht ermittelt werden."
IFS='|' read -r ZIEL_TOTAL_KB ZIEL_FREI_KB ZIEL_FREI_PROZENT <<< "$DF_PREFLIGHT"
ZIEL_FREI_BYTES=$((ZIEL_FREI_KB * 1024))
RESERVE_BYTES=$KAPAZITAET_BYTES
if ((KAPAZITAET_PROZENT > 0)); then
  PROZENT_RESERVE=$((ZIEL_TOTAL_KB * 1024 * KAPAZITAET_PROZENT / 100))
  ((PROZENT_RESERVE <= RESERVE_BYTES)) || RESERVE_BYTES=$PROZENT_RESERVE
fi
ERFORDERLICH_BYTES=$((QUELLE_BYTES + MARGE_BYTES + RESERVE_BYTES))
if ((ZIEL_FREI_BYTES <= ERFORDERLICH_BYTES)); then
  printf '%s: Kapazitaets-Preflight fehlgeschlagen: frei=%d, Quellumfang=%d, Marge=%d, Reserve=%d Bytes. Es wurde kein Snapshot begonnen.\n' \
    "$PROGRAMM" "$ZIEL_FREI_BYTES" "$QUELLE_BYTES" "$MARGE_BYTES" "$RESERVE_BYTES" >&2
  exit 74
fi
printf 'KAPAZITAETS_PREFLIGHT=OK FREI_BYTES=%d QUELLE_BYTES=%d RESERVE_BYTES=%d\n' \
  "$ZIEL_FREI_BYTES" "$QUELLE_BYTES" "$RESERVE_BYTES"

kapazitaet_fuer_zusatzwurzel_pruefen() {
  local quelle=$1 bezeichnung=$2 umfang_kb umfang_bytes marge_bytes
  local df_werte frei_kb frei_bytes erforderlich_bytes
  umfang_kb=$(du -sk "$quelle" | awk '{print $1}') ||
    fehler "Umfang der zusaetzlichen Dokumentwurzel konnte nicht bestimmt werden: $bezeichnung"
  [[ $umfang_kb =~ ^[0-9]+$ ]] ||
    fehler "Umfang der zusaetzlichen Dokumentwurzel ist ungueltig: $bezeichnung"
  umfang_bytes=$((umfang_kb * 1024))
  marge_bytes=$((umfang_bytes / 10))
  ((marge_bytes >= 67108864)) || marge_bytes=67108864
  df_werte=$(df -Pk "$ZIEL_BASIS" | awk 'END {
    if ($4 ~ /^[0-9]+$/) print $4
  }')
  [[ $df_werte =~ ^[0-9]+$ ]] ||
    fehler "Freier Platz konnte vor der zusaetzlichen Dokumentwurzel nicht ermittelt werden."
  frei_kb=$df_werte
  frei_bytes=$((frei_kb * 1024))
  erforderlich_bytes=$((umfang_bytes + marge_bytes + RESERVE_BYTES))
  if ((frei_bytes <= erforderlich_bytes)); then
    printf '%s: Kapazitaets-Preflight fuer externe Dokumentwurzel fehlgeschlagen: quelle=%s frei=%d umfang=%d marge=%d reserve=%d Bytes.\n' \
      "$PROGRAMM" "$bezeichnung" "$frei_bytes" "$umfang_bytes" "$marge_bytes" \
      "$RESERVE_BYTES" >&2
    exit 74
  fi
  printf 'KAPAZITAETS_PREFLIGHT_EXTERN=OK QUELLE=%s FREI_BYTES=%d QUELLE_BYTES=%d RESERVE_BYTES=%d\n' \
    "$bezeichnung" "$frei_bytes" "$umfang_bytes" "$RESERVE_BYTES"
}

GLEICHES_DATEISYSTEM_WARNUNG=
if [[ -n $QUELL_DEVICE && $QUELL_DEVICE == "$ZIEL_DEVICE" ]]; then
  GLEICHES_DATEISYSTEM_WARNUNG="Datenquelle und lokales Sicherungsziel liegen auf demselben Dateisystem/Datentraeger (Device $ZIEL_DEVICE); dies ist keine getrennte lokale Kopie."
  printf 'WARNUNG=GLEICHES_DATEISYSTEM DEVICE=%s\n' "$ZIEL_DEVICE"
fi

STAGE=$ZIEL_BASIS/.gesamt-backup-stage-$LOCK_TOKEN
STAGE_OWNER=${STAGE}.owner
STAGE_OWNER_TEIL=$(mktemp "$ZIEL_BASIS/.stage-owner.XXXXXXXX")
{
  printf 'Betreuungsbuero-Gesamtsicherung-Stage/1\n'
  printf 'STAGE=%s\n' "${STAGE##*/}"
} > "$STAGE_OWNER_TEIL"
mv -- "$STAGE_OWNER_TEIL" "$STAGE_OWNER"
if ! mkdir -- "$STAGE"; then
  rm -f -- "$STAGE_OWNER"
  STAGE_OWNER=
  fehler "Arbeitsverzeichnis fuer die Gesamtsicherung konnte nicht angelegt werden."
fi
mkdir -p -- "$STAGE/datenbank" "$STAGE/inhalt/server-data" "$STAGE/inhalt/externe-dokumentwurzeln" "$STAGE/verwaltung"
printf 'Betreuungsbuero-Gesamtsicherung/1\n' > "$STAGE/verwaltung/SNAPSHOT-FORMAT.txt"
printf '%s\n' "$JOB_ID" > "$STAGE/verwaltung/JOB-ID.txt"
printf '%s\n' "${ZIEL_ID:-unmarkiert}" > "$STAGE/verwaltung/TARGET-ID.txt"
BERICHT=$STAGE/PRUEFBERICHT.txt
MAP=$STAGE/verwaltung/WURZELN.map
WURZELN=$STAGE/verwaltung/WURZELN.tsv
: > "$MAP"
{
  printf 'Gesamtsicherung - Pruefbericht\n'
  printf 'Beginn (lokal): %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
  printf 'Quelldatenbank: %s\n' "$DB_QUELLE"
  printf 'Datenwurzel: %s\n' "$DATEN_QUELLE"
  printf '\nBefunde:\n'
} > "$BERICHT"
printf 'Art\tBereich\tQuelle_Base64_UTF8\tSnapshotziel_Base64_UTF8\n' > "$WURZELN"

befund() {
  FEHLER=$((FEHLER + 1))
  printf -- '- FEHLER: %s\n' "$*" >> "$BERICHT"
}

hinweis() {
  printf -- '- HINWEIS: %s\n' "$*" >> "$BERICHT"
}

hinweis "Sicherungsjob: $JOB_ID"
hinweis "Zielkennung: ${ZIEL_ID:-unmarkiert}; Ziel-Device: ${ZIEL_DEVICE:-unbekannt}; Quell-Device: ${QUELL_DEVICE:-unbekannt}."
if [[ -n $GLEICHES_DATEISYSTEM_WARNUNG ]]; then
  hinweis "WARNUNG: $GLEICHES_DATEISYSTEM_WARNUNG"
fi

# Der verwaltete Recovery-Key wird nur im Speicher gehalten und später
# ausschließlich als Umgebungsvariable an den lokalen Prüfer gereicht. Er
# erscheint weder in Argumenten noch Bericht, Prozessausgabe oder Snapshot.
AKTIVER_RECOVERY_KEY=
AKTIVER_RECOVERY_FP=
AKTIVER_RECOVERY_KEY_ID=
RECOVERY_KEY_DATEI=${DOCUMENT_RECOVERY_KEY_FILE:-$SERVER_DIR/.runtime-secrets/document-recovery-key}
if [[ -f $RECOVERY_KEY_DATEI && ! -L $RECOVERY_KEY_DATEI ]]; then
  AKTIVER_RECOVERY_KEY=$(<"$RECOVERY_KEY_DATEI")
elif [[ -n ${DOCUMENT_RECOVERY_KEY:-} ]]; then
  AKTIVER_RECOVERY_KEY=$DOCUMENT_RECOVERY_KEY
fi
if ((${#AKTIVER_RECOVERY_KEY} >= 16)); then
  RECOVERY_KEY_STATUS=
  if RECOVERY_KEY_STATUS=$(DOCUMENT_RECOVERY_KEY_FILE="$RECOVERY_KEY_DATEI" \
      DOCUMENT_RECOVERY_KEY="${DOCUMENT_RECOVERY_KEY:-}" \
      node -e '
        const status = require(process.argv[1]).shared().publicStatus();
        process.stdout.write([
          status.configured ? "yes" : "no",
          status.strong ? "yes" : "no",
          status.requiresRotation ? "yes" : "no",
          String(status.keyId || ""),
          String(status.source || "")
        ].join("|"));
      ' "$SERVER_DIR/src/modules/recovery/key-store.js" 2>&1); then
    IFS='|' read -r REC_CONFIGURED REC_STRONG REC_ROTATION AKTIVER_RECOVERY_KEY_ID REC_KEY_SOURCE <<< "$RECOVERY_KEY_STATUS"
    if [[ $REC_CONFIGURED != yes || $REC_STRONG != yes || $REC_ROTATION != no ||
          ( $REC_KEY_SOURCE == admin-panel &&
            ! $AKTIVER_RECOVERY_KEY_ID =~ ^drk_[0-9a-fA-F-]{36}$ ) ||
          ( $REC_KEY_SOURCE == environment &&
            ! $AKTIVER_RECOVERY_KEY_ID =~ ^legacy_[0-9a-fA-F]{32}$ ) ||
          ( $REC_KEY_SOURCE != admin-panel && $REC_KEY_SOURCE != environment ) ]]; then
      befund "Der aktive Wiederherstellungsschluessel ist ein schwacher oder rotationspflichtiger Legacy-Schluessel."
    fi
  else
    befund "Status und Metadaten des aktiven Wiederherstellungsschluessels konnten nicht sicher validiert werden: $RECOVERY_KEY_STATUS"
  fi
  if ! AKTIVER_RECOVERY_FP=$(BACKUP_RECOVERY_KEY="$AKTIVER_RECOVERY_KEY" \
      node -e '
        const secure = require(process.argv[1]);
        process.stdout.write(secure.fingerprint(process.env.BACKUP_RECOVERY_KEY));
      ' "$SERVER_DIR/src/security/secure-json.js" 2>/dev/null); then
    AKTIVER_RECOVERY_FP=
    befund "Der Recovery-Key-Fingerabdruck konnte nicht mit secure-json bestimmt werden."
  elif [[ ! $AKTIVER_RECOVERY_FP =~ ^[0-9a-fA-F]{24}$ ]]; then
    AKTIVER_RECOVERY_FP=
    befund "secure-json hat keinen gueltigen Recovery-Key-Fingerabdruck geliefert."
  fi
  if [[ -n $ERWARTETER_RECOVERY_FP &&
        ( -z $AKTIVER_RECOVERY_FP ||
          $(printf '%s' "$ERWARTETER_RECOVERY_FP" | tr 'A-F' 'a-f') != "$AKTIVER_RECOVERY_FP" ) ]]; then
    befund "Konfigurierter Recovery-Key und erwarteter Fingerabdruck widersprechen sich."
  fi
  if [[ -z $ERWARTETER_RECOVERY_FP && -n $AKTIVER_RECOVERY_FP ]]; then
    ERWARTETER_RECOVERY_FP=$AKTIVER_RECOVERY_FP
  fi
  hinweis "Aktiver Recovery-Key ist verfuegbar; beide Pflichtabbilder werden authentifiziert entschluesselt und inhaltlich geprueft."
elif [[ -e $RECOVERY_KEY_DATEI || -n ${DOCUMENT_RECOVERY_KEY:-} ]]; then
  befund "Der aktive Wiederherstellungsschluessel ist nicht lesbar oder zu kurz."
else
  if ((RECOVERY_AUSNAHME)); then
    hinweis "AUSNAHME AKTIV: Recovery-Key ist nicht zugaenglich; die Pflichtabbilder bleiben kryptografisch ungeprueft (Struktur, Hashes und Fingerabdruecke werden dennoch geprueft)."
  else
    befund "Aktiver Recovery-Key ist nicht zugaenglich; die Pflichtabbilder sind kryptografisch ungeprueft und die Wiederherstellbarkeitsprobe ist nicht erbracht."
  fi
fi
fi

b64() {
  printf '%s' "$1" | base64 | tr -d '\r\n'
}

hex() {
  printf '%s' "$1" | LC_ALL=C od -An -tx1 | tr -d ' \n'
}

hex_nach_variable() {
  local __ziel=$1 __hex=$2 __ausgabe= __paar
  while [[ -n $__hex ]]; do
    __paar=${__hex:0:2}
    __hex=${__hex:2}
    printf -v __paar '%b' "\\x$__paar"
    __ausgabe=$__ausgabe$__paar
  done
  printf -v "$__ziel" '%s' "$__ausgabe"
}

b64_nach_variable() {
  local __ziel=$1 __wert=$2 __ausgabe
  __ausgabe=$(printf '%s' "$__wert" | base64 "$B64_FLAG"; printf /) || return 1
  __ausgabe=${__ausgabe%/}
  printf -v "$__ziel" '%s' "$__ausgabe"
}

manifest_pfad_sicher() {
  local p=$1
  [[ -n $p && $p != /* ]] || return 1
  enthaelt_steuerzeichen "$p" && return 1
  case "/$p/" in
    */../*|*/./*) return 1 ;;
  esac
  return 0
}

snapshot_eigen() {
  local snapshot=$1 marker
  marker=$snapshot/verwaltung/SNAPSHOT-FORMAT.txt
  [[ -f $marker && ! -L $marker ]] || return 1
  [[ $(<"$marker") == Betreuungsbuero-Gesamtsicherung/1 ]]
}

snapshot_gehoert_job() {
  local snapshot=$1
  snapshot_eigen "$snapshot" || return 1
  [[ -f $snapshot/verwaltung/JOB-ID.txt &&
     ! -L $snapshot/verwaltung/JOB-ID.txt &&
     $(<"$snapshot/verwaltung/JOB-ID.txt") == "$JOB_ID" ]] || return 1
  if [[ -n $ZIEL_ID ]]; then
    [[ -f $snapshot/verwaltung/TARGET-ID.txt &&
       ! -L $snapshot/verwaltung/TARGET-ID.txt &&
       $(<"$snapshot/verwaltung/TARGET-ID.txt") == "$ZIEL_ID" ]] || return 1
  fi
}

snapshot_gehoert_target() {
  local snapshot=$1 snapshot_job
  snapshot_eigen "$snapshot" || return 1
  [[ -f $snapshot/verwaltung/JOB-ID.txt &&
     ! -L $snapshot/verwaltung/JOB-ID.txt ]] || return 1
  snapshot_job=$(<"$snapshot/verwaltung/JOB-ID.txt")
  [[ $snapshot_job =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$ ]] || return 1
  [[ -f $snapshot/verwaltung/TARGET-ID.txt &&
     ! -L $snapshot/verwaltung/TARGET-ID.txt &&
     $(<"$snapshot/verwaltung/TARGET-ID.txt") == "${ZIEL_ID:-unmarkiert}" ]]
}

pruefe_manifest_inhalt() {
  local snapshot=$1 manifest_soll manifest_ist soll_hash soll_groesse rel_b64
  local rel ist_groesse ist_hash dateien manifest_zeilen
  [[ -d $snapshot && ! -L $snapshot ]] || return 1
  [[ -f $snapshot/MANIFEST.tsv && ! -L $snapshot/MANIFEST.tsv &&
     -f $snapshot/MANIFEST.tsv.sha256 && ! -L $snapshot/MANIFEST.tsv.sha256 ]] || return 1
  read -r manifest_soll < "$snapshot/MANIFEST.tsv.sha256" || return 1
  manifest_ist=$(sha_datei "$snapshot/MANIFEST.tsv" | tr 'A-F' 'a-f')
  manifest_soll=$(printf '%s' "$manifest_soll" | tr 'A-F' 'a-f')
  [[ $manifest_soll =~ ^[0-9a-f]{64}$ && $manifest_ist == "$manifest_soll" ]] || return 1
  while IFS=$'\t' read -r soll_hash soll_groesse rel_b64; do
    [[ $soll_hash =~ ^[0-9a-fA-F]{64}$ && $soll_groesse =~ ^[0-9]+$ &&
       -n ${rel_b64:-} ]] || return 1
    b64_nach_variable rel "$rel_b64" || return 1
    manifest_pfad_sicher "$rel" || return 1
    [[ -f $snapshot/$rel && ! -L $snapshot/$rel ]] || return 1
    ist_groesse=$(wc -c < "$snapshot/$rel" | tr -d ' ')
    [[ $ist_groesse == "$soll_groesse" ]] || return 1
    ist_hash=$(sha_datei "$snapshot/$rel" | tr 'A-F' 'a-f')
    soll_hash=$(printf '%s' "$soll_hash" | tr 'A-F' 'a-f')
    [[ $ist_hash == "$soll_hash" ]] || return 1
  done < "$snapshot/MANIFEST.tsv"
  # MANIFEST.tsv und seine Prüfsummendatei entstehen erst nach der
  # Manifest-Aufzählung. Jede weitere Datei wäre eine nachträgliche,
  # nicht authentifizierte Beigabe und darf nicht offsite übertragen werden.
  manifest_zeilen=$(wc -l < "$snapshot/MANIFEST.tsv" | tr -d ' ')
  dateien=$(find "$snapshot" -type f | wc -l | tr -d ' ')
  [[ $dateien -eq $((manifest_zeilen + 2)) ]] || return 1
  if find "$snapshot" -type l -print | grep -q .; then return 1; fi
  if find "$snapshot" ! -type f ! -type d ! -type l -print | grep -q .; then return 1; fi
  return 0
}

pruefe_snapshot_manifest() {
  local snapshot=$1
  [[ -d $snapshot && ! -L $snapshot ]] || return 1
  [[ $(kanon_ordner "$(dirname -- "$snapshot")") == "$ZIEL_BASIS" ]] || return 1
  snapshot_eigen "$snapshot" || return 1
  [[ -f $snapshot/STATUS.txt && ! -L $snapshot/STATUS.txt &&
     $(<"$snapshot/STATUS.txt") == VOLLSTAENDIG ]] || return 1
  pruefe_manifest_inhalt "$snapshot"
}

loesche_snapshot_kontrolliert() {
  local kandidat=$1 basis=$2 grund=$3 zwischen abandoned owner tomb_name retention_token
  [[ -d $kandidat && ! -L $kandidat ]] || return 1
  # Ein Pending-Sidecar ist unabhängig vom aktuell aktivierten Profil eine
  # dauerhafte Schutzmarke. Er darf weder verwaisen noch zusammen mit einer
  # noch nicht remote bestätigten Generation entfernt werden.
  [[ ! -e ${kandidat}.offsite-pending ]] || return 1
  abandoned=${kandidat}.offsite-abandoned
  if [[ -e $abandoned ]]; then
    offsite_abandoned_valide "$kandidat" || return 1
  fi
  [[ $(kanon_ordner "$(dirname -- "$kandidat")") == "$ZIEL_BASIS" ]] || return 1
  [[ ${kandidat##*/} == "$basis" ]] || return 1
  retention_token=$(node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))") ||
    return 1
  [[ $retention_token =~ ^[0-9a-f]{32}$ ]] || return 1
  tomb_name=.retention-delete-${basis}-${retention_token}
  zwischen=$ZIEL_BASIS/$tomb_name
  owner=${zwischen}.owner
  [[ ! -e $zwischen && ! -e $owner ]] || return 1
  node - "$owner" "$tomb_name" "$basis" "${ZIEL_ID:-unmarkiert}" <<'NODE' ||
const fs = require('fs');
const path = require('path');
const [file, tomb, snapshot, targetId] = process.argv.slice(2);
if (!/^\.retention-delete-Gesamtsicherung_[0-9]{8}_[0-9]{6}(?:_[A-Za-z0-9_.-]+)?-[0-9a-f]{32}$/.test(tomb)
    || !/^Gesamtsicherung_[0-9]{8}_[0-9]{6}(?:_[A-Za-z0-9_.-]+)?$/.test(snapshot)
    || tomb !== `.retention-delete-${snapshot}-${tomb.slice(-32)}`
    || !/^(?:unmarkiert|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(targetId)) {
  process.exit(2);
}
const content = [
  'Betreuungsbuero-Retention-Tombstone/1',
  `TOMB=${tomb}`,
  `SNAPSHOT=${snapshot}`,
  `TARGET_ID=${targetId}`,
  ''
].join('\n');
const fd = fs.openSync(
  file,
  fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0),
  0o600
);
try {
  fs.writeFileSync(fd, content, 'utf8');
  fs.fsyncSync(fd);
} finally {
  fs.closeSync(fd);
}
const parent = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
NODE
    return 1
  mv -- "$kandidat" "$zwischen"
  dauerhaft_synchronisieren "$ZIEL_BASIS" || return 1
  if [[ ${NODE_ENV:-} == test &&
        ${GESAMT_BACKUP_TEST_RETENTION_CRASH_AT:-} == after-rename ]]; then
    kill -KILL $$
  fi
  rm -rf -- "$zwischen"
  if [[ ${NODE_ENV:-} == test &&
        ${GESAMT_BACKUP_TEST_RETENTION_CRASH_AT:-} == after-tree-delete ]]; then
    kill -KILL $$
  fi
  rm -f -- "${kandidat}.offsite-status" "${kandidat}.offsite.log" "$abandoned"
  rm -f -- "$owner"
  dauerhaft_synchronisieren "$ZIEL_BASIS" || return 1
  printf '%s %s geloescht: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$grund" "$basis" \
      >> "$ZIEL_BASIS/backup-maintenance.log"
}

status_wert() {
  local datei=$1 schluessel=$2
  awk -v key="$schluessel" '
    index($0,key ": ")==1 {
      print substr($0,length(key)+3)
      n++
    }
    END { if (n!=1) exit 1 }
  ' "$datei"
}

offsite_status_retention_positiv() {
  local snapshot=$1 status manifest_sha format status_snapshot target_id
  local status_job profile_sha job_tag restic_snapshot_id modus status_manifest
  local zeit tag
  local zeit_muster='^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} [+-][0-9]{4}$'
  status=${snapshot}.offsite-status
  [[ -f $status && ! -L $status ]] || return 1
  [[ $(wc -c < "$status" | tr -d ' ') -le 8192 &&
     $(wc -l < "$status" | tr -d ' ') -eq 12 ]] || return 1
  [[ $(sed -n '1p' "$status") == OK ]] || return 1
  manifest_sha=$(sha_datei "$snapshot/MANIFEST.tsv" 2>/dev/null || true)
  manifest_sha=$(printf '%s' "$manifest_sha" | tr 'A-F' 'a-f')
  [[ $manifest_sha =~ ^[0-9a-f]{64}$ ]] || return 1
  format=$(status_wert "$status" Format 2>/dev/null || true)
  status_snapshot=$(status_wert "$status" Snapshot 2>/dev/null || true)
  target_id=$(status_wert "$status" Target-ID 2>/dev/null || true)
  status_job=$(status_wert "$status" Job-ID 2>/dev/null || true)
  profile_sha=$(status_wert "$status" Profil-SHA-256 2>/dev/null || true)
  job_tag=$(status_wert "$status" Restic-Job-Tag 2>/dev/null || true)
  restic_snapshot_id=$(status_wert "$status" Restic-Snapshot-ID 2>/dev/null || true)
  modus=$(status_wert "$status" Modus 2>/dev/null || true)
  zeit=$(status_wert "$status" Zeit 2>/dev/null || true)
  tag=$(status_wert "$status" Tag 2>/dev/null || true)
  status_manifest=$(status_wert "$status" Manifest-SHA-256 2>/dev/null || true)
  status_manifest=$(printf '%s' "$status_manifest" | tr 'A-F' 'a-f')
  [[ $format == Betreuungsbuero-Offsite-Status/2 &&
     $status_snapshot == "${snapshot##*/}" &&
     $target_id == "${ZIEL_ID:-unmarkiert}" &&
     $status_manifest == "$manifest_sha" &&
     $status_job == "$JOB_ID" &&
     $profile_sha =~ ^[0-9a-fA-F]{64}$ &&
     $job_tag == "$OFFSITE_JOB_TAG" &&
     $restic_snapshot_id =~ ^[0-9a-fA-F]{8,64}$ &&
     $modus == restic &&
     $zeit =~ $zeit_muster &&
     $tag =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]
}

offsite_status_positiv() {
  local snapshot=$1 status profile_sha
  offsite_status_retention_positiv "$snapshot" || return 1
  status=${snapshot}.offsite-status
  profile_sha=$(status_wert "$status" Profil-SHA-256 2>/dev/null || true)
  [[ $profile_sha == "$OFFSITE_PROFILE_SHA" ]]
}

sidecar_wert() {
  local datei=$1 schluessel=$2
  awk -F= -v key="$schluessel" '
    $1==key {
      sub(/^[^=]*=/,"")
      print
      n++
    }
    END { if (n!=1) exit 1 }
  ' "$datei"
}

offsite_abandoned_valide() {
  local snapshot=$1 abandoned format state_snapshot manifest_sha profile_sha
  local state_job target_id created_at ist_manifest snapshot_job
  abandoned=${snapshot}.offsite-abandoned
  [[ -f $abandoned && ! -L $abandoned ]] || return 1
  [[ $(wc -c < "$abandoned" | tr -d ' ') -le 4096 &&
     $(wc -l < "$abandoned" | tr -d ' ') -eq 7 ]] || return 1
  if grep -Ev \
      '^(FORMAT|SNAPSHOT|MANIFEST_SHA|PROFILE_SHA|JOB_ID|TARGET_ID|CREATED_AT)=[^[:cntrl:]]*$' \
      "$abandoned" | grep -q .; then
    return 1
  fi
  format=$(sidecar_wert "$abandoned" FORMAT 2>/dev/null || true)
  state_snapshot=$(sidecar_wert "$abandoned" SNAPSHOT 2>/dev/null || true)
  manifest_sha=$(sidecar_wert "$abandoned" MANIFEST_SHA 2>/dev/null || true)
  profile_sha=$(sidecar_wert "$abandoned" PROFILE_SHA 2>/dev/null || true)
  state_job=$(sidecar_wert "$abandoned" JOB_ID 2>/dev/null || true)
  target_id=$(sidecar_wert "$abandoned" TARGET_ID 2>/dev/null || true)
  created_at=$(sidecar_wert "$abandoned" CREATED_AT 2>/dev/null || true)
  [[ $format == Betreuungsbuero-Offsite-Pending/1 &&
     $state_snapshot == "${snapshot##*/}" &&
     $manifest_sha =~ ^[0-9a-fA-F]{64}$ &&
     $profile_sha =~ ^[0-9a-fA-F]{64}$ &&
     $state_job =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$ &&
     $target_id == "${ZIEL_ID:-unmarkiert}" &&
     $created_at =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    return 1
  snapshot_gehoert_target "$snapshot" || return 1
  snapshot_job=$(<"$snapshot/verwaltung/JOB-ID.txt")
  [[ $state_job == "$snapshot_job" ]] || return 1
  pruefe_snapshot_manifest "$snapshot" || return 1
  ist_manifest=$(sha_datei "$snapshot/MANIFEST.tsv" 2>/dev/null || true)
  ist_manifest=$(printf '%s' "$ist_manifest" | tr 'A-F' 'a-f')
  manifest_sha=$(printf '%s' "$manifest_sha" | tr 'A-F' 'a-f')
  [[ $ist_manifest == "$manifest_sha" ]]
}

retention_anwenden() {
  local liste behalten tage monate jahre kandidat basis datum monat jahr keep
  local daily_count=0 monthly_count=0 yearly_count=0 geloescht=0
  ((RETENTION_DAILY > 0 || RETENTION_MONTHLY > 0 || RETENTION_YEARLY > 0)) || return 0
  liste=$(mktemp "$ZIEL_BASIS/.retention-liste.XXXXXXXX")
  behalten=$(mktemp "$ZIEL_BASIS/.retention-behalten.XXXXXXXX")
  tage=$(mktemp "$ZIEL_BASIS/.retention-tage.XXXXXXXX")
  monate=$(mktemp "$ZIEL_BASIS/.retention-monate.XXXXXXXX")
  jahre=$(mktemp "$ZIEL_BASIS/.retention-jahre.XXXXXXXX")
  : > "$liste"; : > "$behalten"; : > "$tage"; : > "$monate"; : > "$jahre"
  for kandidat in "$ZIEL_BASIS"/Gesamtsicherung_*; do
    [[ -d $kandidat && ! -L $kandidat ]] || continue
    basis=${kandidat##*/}
    [[ $basis =~ ^Gesamtsicherung_([0-9]{8})_([0-9]{6})(_[[:alnum:]_.-]+)?$ ]] || continue
    snapshot_gehoert_job "$kandidat" || continue
    if ! pruefe_snapshot_manifest "$kandidat"; then
      printf 'WARNUNG=RETENTION_SNAPSHOT_UNGEPRUEFT SNAPSHOT=%s\n' "$basis" >&2
      continue
    fi
    if [[ -e ${kandidat}.offsite-abandoned ]]; then
      if offsite_abandoned_valide "$kandidat"; then
        printf 'HINWEIS=RETENTION_ABANDONED_GETRENNT SNAPSHOT=%s\n' "$basis"
      else
        printf 'WARNUNG=RETENTION_ABANDONED_UNGUELTIG SNAPSHOT=%s\n' "$basis" >&2
      fi
      continue
    fi
    # Schutz gilt auch wenn Offsite später deaktiviert oder auf ein anderes
    # Profil umgestellt wurde.
    if [[ -e ${kandidat}.offsite-pending ]]; then
      printf 'WARNUNG=RETENTION_PENDING_GESCHUETZT SNAPSHOT=%s\n' "$basis" >&2
      continue
    fi
    # Bei aktivem Offsiteprofil reicht das Fehlen eines Pending-Sidecars nicht
    # als Löschberechtigung. Der positive Status muss vollständig an
    # Job/Target/Snapshot/Manifest/Job-Tag gebunden sein. Sein Profil darf
    # historisch sein: Ein legitimer Profilwechsel macht einen früher bereits
    # bestätigten lokalen Snapshot nicht unverlöschbar.
    if [[ $OFFSITE_MODE == restic ]]; then
      [[ ! -e ${kandidat}.offsite-pending ]] || continue
      if ! offsite_status_retention_positiv "$kandidat"; then
        printf 'WARNUNG=RETENTION_OFFSITE_UNBESTAETIGT SNAPSHOT=%s\n' "$basis" >&2
        continue
      fi
    fi
    printf '%s\n' "$kandidat" >> "$liste"
  done
  LC_ALL=C sort -r "$liste" -o "$liste"
  [[ -n ${FINAL:-} ]] && printf '%s\n' "$FINAL" >> "$behalten"
  while IFS= read -r kandidat; do
    basis=${kandidat##*/}
    [[ $basis =~ ^Gesamtsicherung_([0-9]{8})_([0-9]{6})(_[[:alnum:]_.-]+)?$ ]] || continue
    datum=${BASH_REMATCH[1]}
    monat=${datum:0:6}
    jahr=${datum:0:4}
    keep=0
    if ((daily_count < RETENTION_DAILY)) && ! grep -Fqx -- "$datum" "$tage"; then
      printf '%s\n' "$datum" >> "$tage"; daily_count=$((daily_count + 1)); keep=1
    fi
    if ((monthly_count < RETENTION_MONTHLY)) && ! grep -Fqx -- "$monat" "$monate"; then
      printf '%s\n' "$monat" >> "$monate"; monthly_count=$((monthly_count + 1)); keep=1
    fi
    if ((yearly_count < RETENTION_YEARLY)) && ! grep -Fqx -- "$jahr" "$jahre"; then
      printf '%s\n' "$jahr" >> "$jahre"; yearly_count=$((yearly_count + 1)); keep=1
    fi
    ((keep)) && printf '%s\n' "$kandidat" >> "$behalten"
  done < "$liste"
  while IFS= read -r kandidat; do
    grep -Fqx -- "$kandidat" "$behalten" && continue
    basis=${kandidat##*/}
    [[ $basis =~ ^Gesamtsicherung_[0-9]{8}_[0-9]{6}(_[[:alnum:]_.-]+)?$ ]] || continue
    # Zwischen Auswahl und Löschung kann ein Datenträger-/Dateifehler auftreten.
    # Der Kandidat wird daher unmittelbar vor dem kontrollierten Rename erneut
    # vollständig gelesen und bei aktivem Offsite erneut positiv attestiert.
    if ! pruefe_snapshot_manifest "$kandidat"; then
      printf 'WARNUNG=RETENTION_ABBRUCH_MANIFEST SNAPSHOT=%s\n' "$basis" >&2
      continue
    fi
    if [[ -e ${kandidat}.offsite-pending ]]; then
      printf 'WARNUNG=RETENTION_ABBRUCH_PENDING SNAPSHOT=%s\n' "$basis" >&2
      continue
    fi
    if [[ -e ${kandidat}.offsite-abandoned ]]; then
      printf 'WARNUNG=RETENTION_ABBRUCH_ABANDONED SNAPSHOT=%s\n' "$basis" >&2
      continue
    fi
    if [[ $OFFSITE_MODE == restic ]] &&
       ! offsite_status_retention_positiv "$kandidat"; then
      printf 'WARNUNG=RETENTION_ABBRUCH_OFFSITE SNAPSHOT=%s\n' "$basis" >&2
      continue
    fi
    loesche_snapshot_kontrolliert "$kandidat" "$basis" Retention || {
      rm -f -- "$liste" "$behalten" "$tage" "$monate" "$jahre"
      return 73
    }
    geloescht=$((geloescht + 1))
  done < "$liste"
  rm -f -- "$liste" "$behalten" "$tage" "$monate" "$jahre"
  printf 'RETENTION=OK GELOESCHT=%d DAILY=%d MONTHLY=%d YEARLY=%d\n' \
    "$geloescht" "$RETENTION_DAILY" "$RETENTION_MONTHLY" "$RETENTION_YEARLY"
  abandoned_retention_anwenden
}

abandoned_retention_anwenden() {
  local alle abandoned behalten tage monate jahre kandidat sidecar basis
  local datum monat jahr keep geloescht=0 kandidaten=0
  local daily_count=0 monthly_count=0 yearly_count=0
  local max_loeschungen=$((RETENTION_DAILY + RETENTION_MONTHLY + RETENTION_YEARLY))
  ((max_loeschungen > 0)) || return 0
  alle=$(mktemp "$ZIEL_BASIS/.abandoned-retention-alle.XXXXXXXX")
  abandoned=$(mktemp "$ZIEL_BASIS/.abandoned-retention-kandidaten.XXXXXXXX")
  behalten=$(mktemp "$ZIEL_BASIS/.abandoned-retention-behalten.XXXXXXXX")
  tage=$(mktemp "$ZIEL_BASIS/.abandoned-retention-tage.XXXXXXXX")
  monate=$(mktemp "$ZIEL_BASIS/.abandoned-retention-monate.XXXXXXXX")
  jahre=$(mktemp "$ZIEL_BASIS/.abandoned-retention-jahre.XXXXXXXX")
  : > "$alle"; : > "$abandoned"; : > "$behalten"
  : > "$tage"; : > "$monate"; : > "$jahre"
  for kandidat in "$ZIEL_BASIS"/Gesamtsicherung_*; do
    [[ -d $kandidat && ! -L $kandidat ]] || continue
    basis=${kandidat##*/}
    [[ $basis =~ ^Gesamtsicherung_([0-9]{8})_([0-9]{6})(_[[:alnum:]_.-]+)?$ ]] ||
      continue
    snapshot_gehoert_target "$kandidat" || continue
    pruefe_snapshot_manifest "$kandidat" || continue
    printf '%s\n' "$kandidat" >> "$alle"
    sidecar=${kandidat}.offsite-abandoned
    [[ -e $sidecar ]] || continue
    if [[ -e ${kandidat}.offsite-pending ]]; then
      printf 'WARNUNG=ABANDONED_RETENTION_DOPPELSTATUS SNAPSHOT=%s\n' "$basis" >&2
      continue
    fi
    if ! offsite_abandoned_valide "$kandidat"; then
      printf 'WARNUNG=ABANDONED_RETENTION_UNGUELTIG SNAPSHOT=%s\n' "$basis" >&2
      continue
    fi
    printf '%s\n' "$kandidat" >> "$abandoned"
    kandidaten=$((kandidaten + 1))
  done
  LC_ALL=C sort -r "$alle" -o "$alle"
  LC_ALL=C sort -r "$abandoned" -o "$abandoned"
  # Der Kalenderplan wird gegen alle vollständigen Generationen desselben
  # Zielmediums gebildet. Dadurch altert auch eine einzelne Generation eines
  # später gelöschten Jobs aus, sobald neuere reguläre Generationen vorliegen,
  # ohne die Retention eines aktiven Jobs selbst zu verändern.
  while IFS= read -r kandidat; do
    basis=${kandidat##*/}
    [[ $basis =~ ^Gesamtsicherung_([0-9]{8})_([0-9]{6})(_[[:alnum:]_.-]+)?$ ]] ||
      continue
    datum=${BASH_REMATCH[1]}
    monat=${datum:0:6}
    jahr=${datum:0:4}
    keep=0
    if ((daily_count < RETENTION_DAILY)) && ! grep -Fqx -- "$datum" "$tage"; then
      printf '%s\n' "$datum" >> "$tage"
      daily_count=$((daily_count + 1))
      keep=1
    fi
    if ((monthly_count < RETENTION_MONTHLY)) && ! grep -Fqx -- "$monat" "$monate"; then
      printf '%s\n' "$monat" >> "$monate"
      monthly_count=$((monthly_count + 1))
      keep=1
    fi
    if ((yearly_count < RETENTION_YEARLY)) && ! grep -Fqx -- "$jahr" "$jahre"; then
      printf '%s\n' "$jahr" >> "$jahre"
      yearly_count=$((yearly_count + 1))
      keep=1
    fi
    ((keep)) && printf '%s\n' "$kandidat" >> "$behalten"
  done < "$alle"
  while IFS= read -r kandidat; do
    [[ -n $kandidat ]] || continue
    grep -Fqx -- "$kandidat" "$behalten" && continue
    ((geloescht < max_loeschungen)) || {
      printf 'WARNUNG=ABANDONED_RETENTION_BEGRENZT MAX=%d REST_OFFEN=1\n' \
        "$max_loeschungen" >&2
      break
    }
    basis=${kandidat##*/}
    if [[ -e ${kandidat}.offsite-pending ]] ||
       ! offsite_abandoned_valide "$kandidat" ||
       ! pruefe_snapshot_manifest "$kandidat"; then
      printf 'WARNUNG=ABANDONED_RETENTION_ABBRUCH SNAPSHOT=%s\n' "$basis" >&2
      continue
    fi
    loesche_snapshot_kontrolliert "$kandidat" "$basis" Abandoned-Retention || {
      rm -f -- "$alle" "$abandoned" "$behalten" "$tage" "$monate" "$jahre"
      return 73
    }
    geloescht=$((geloescht + 1))
  done < "$abandoned"
  rm -f -- "$alle" "$abandoned" "$behalten" "$tage" "$monate" "$jahre"
  printf 'ABANDONED_RETENTION=OK KANDIDATEN=%d GELOESCHT=%d MAX_PRO_LAUF=%d\n' \
    "$kandidaten" "$geloescht" "$max_loeschungen"
}

diagnose_retention_anwenden() {
  local liste kandidat basis nummer=0 geloescht=0
  ((RETENTION_DIAGNOSTIC > 0)) || return 0
  liste=$(mktemp "$ZIEL_BASIS/.diagnose-retention.XXXXXXXX")
  : > "$liste"
  for kandidat in "$ZIEL_BASIS"/Gesamtsicherung_*; do
    [[ -d $kandidat && ! -L $kandidat ]] || continue
    basis=${kandidat##*/}
    [[ $basis =~ ^Gesamtsicherung_[0-9]{8}_[0-9]{6}(_[[:alnum:]_.-]+)?_UNVOLLSTAENDIG(_[0-9]+)?$ ]] || continue
    [[ -f $kandidat/STATUS.txt && ! -L $kandidat/STATUS.txt &&
       $(<"$kandidat/STATUS.txt") == UNVOLLSTAENDIG ]] || continue
    [[ -f $kandidat/MANIFEST.tsv && ! -L $kandidat/MANIFEST.tsv ]] || continue
    snapshot_gehoert_job "$kandidat" || continue
    printf '%s\n' "$kandidat" >> "$liste"
  done
  LC_ALL=C sort -r "$liste" -o "$liste"
  while IFS= read -r kandidat; do
    nummer=$((nummer + 1))
    ((nummer <= RETENTION_DIAGNOSTIC)) && continue
    basis=${kandidat##*/}
    loesche_snapshot_kontrolliert "$kandidat" "$basis" Diagnose-Retention || {
      rm -f -- "$liste"
      return 73
    }
    geloescht=$((geloescht + 1))
  done < "$liste"
  rm -f -- "$liste"
  printf 'DIAGNOSE_RETENTION=OK BEHALTEN=%d GELOESCHT=%d\n' \
    "$RETENTION_DIAGNOSTIC" "$geloescht"
}

OFFSITE_PROFILE_SHA=
if [[ $OFFSITE_MODE == restic ]]; then
  OFFSITE_JOB_TAG=bb-job-$(printf 'job=%s\n' "$JOB_ID" | sha_stdin | cut -c1-24)
  OFFSITE_PROFILE_SHA=$(printf 'repository=%s\ntag=%s\njob_tag=%s\n' \
    "$OFFSITE_REPOSITORY" "$OFFSITE_TAG" "$OFFSITE_JOB_TAG" | sha_stdin)
  OFFSITE_STATE_DIR=$ZIEL_BASIS/.betreuungsbuero-backup-state/$JOB_TOKEN/$OFFSITE_PROFILE_SHA
  mkdir -p -- "$OFFSITE_STATE_DIR/quarantaene"
  for OFFSITE_TEMP in \
    "$OFFSITE_STATE_DIR"/.restic-output.* \
    "$OFFSITE_STATE_DIR"/.restore-probe.* \
    "$OFFSITE_STATE_DIR"/.manifest-probe.* \
    "$OFFSITE_STATE_DIR"/.manifest-sha-probe.* \
    "$OFFSITE_STATE_DIR"/.content-probe.* \
    "$OFFSITE_STATE_DIR"/.last-check.* \
    "$OFFSITE_STATE_DIR"/.read-check-slot.*; do
    [[ -f $OFFSITE_TEMP && ! -L $OFFSITE_TEMP ]] || continue
    rm -f -- "$OFFSITE_TEMP"
  done
fi

offsite_status_schreiben() {
  local snapshot=$1 status=$2 rc=${3:-0} snapshot_id=${4:-} temp manifest_sha
  manifest_sha=$(sha_datei "$snapshot/MANIFEST.tsv") || return 74
  [[ $manifest_sha =~ ^[0-9a-fA-F]{64}$ ]] || return 74
  temp=$(mktemp "$ZIEL_BASIS/.offsite-status.XXXXXXXX")
  {
    printf '%s\n' "$status"
    printf 'Format: Betreuungsbuero-Offsite-Status/2\n'
    printf 'Snapshot: %s\n' "${snapshot##*/}"
    printf 'Target-ID: %s\n' "${ZIEL_ID:-unmarkiert}"
    printf 'Manifest-SHA-256: %s\n' "$manifest_sha"
    printf 'Zeit: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
    printf 'Modus: restic\n'
    printf 'Tag: %s\n' "$OFFSITE_TAG"
    printf 'Restic-Job-Tag: %s\n' "$OFFSITE_JOB_TAG"
    printf 'Job-ID: %s\n' "$JOB_ID"
    printf 'Profil-SHA-256: %s\n' "$OFFSITE_PROFILE_SHA"
    [[ -z $snapshot_id ]] || printf 'Restic-Snapshot-ID: %s\n' "$snapshot_id"
    [[ $status != FEHLER ]] || printf 'Rueckgabecode: %d\n' "$rc"
  } > "$temp"
  mv -- "$temp" "${snapshot}.offsite-status"
  dauerhaft_synchronisieren "${snapshot}.offsite-status" "$ZIEL_BASIS" || {
    printf 'OFFSITE=FEHLER GRUND=STATUS_NICHT_DAUERHAFT SNAPSHOT=%s\n' "$snapshot" >&2
    return 74
  }
}

offsite_pending_schreiben() {
  local snapshot=$1 temp manifest_sha
  manifest_sha=$(sha_datei "$snapshot/MANIFEST.tsv")
  temp=$(mktemp "$ZIEL_BASIS/.offsite-pending.XXXXXXXX")
  {
    printf 'FORMAT=Betreuungsbuero-Offsite-Pending/1\n'
    printf 'SNAPSHOT=%s\n' "${snapshot##*/}"
    printf 'MANIFEST_SHA=%s\n' "$manifest_sha"
    printf 'PROFILE_SHA=%s\n' "$OFFSITE_PROFILE_SHA"
    printf 'JOB_ID=%s\n' "$JOB_ID"
    printf 'TARGET_ID=%s\n' "${ZIEL_ID:-unmarkiert}"
    printf 'CREATED_AT=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } > "$temp"
  mv -- "$temp" "${snapshot}.offsite-pending"
  dauerhaft_synchronisieren "${snapshot}.offsite-pending" "$ZIEL_BASIS" || {
    printf 'OFFSITE=FEHLER GRUND=PENDING_NICHT_DAUERHAFT SNAPSHOT=%s\n' "$snapshot" >&2
    return 74
  }
}

restic_snapshot_id() {
  node -e '
    const fs=require("fs"); let id="";
    for (const line of fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { const row=JSON.parse(line); if (row && row.snapshot_id) id=String(row.snapshot_id); } catch (_) {}
    }
    if (!/^[0-9a-f]{8,64}$/i.test(id)) process.exit(1);
    process.stdout.write(id);
  ' "$1"
}

offsite_pruefen_falls_faellig() {
  local snapshot=$1 snapshot_id=$2 now last=0 probe manifest_remote manifest_sha_remote
  local sample sample_hash sample_size sample_b64 sample_rel sample_file rc temp_check
  local letzter_slot=0 pruef_slot temp_slot
  now=$(date +%s)
  if [[ -f $OFFSITE_STATE_DIR/last-check-epoch && ! -L $OFFSITE_STATE_DIR/last-check-epoch ]]; then
    last=$(<"$OFFSITE_STATE_DIR/last-check-epoch")
    [[ $last =~ ^[0-9]+$ ]] || last=0
  fi
  ((now - last >= OFFSITE_CHECK_DAYS * 86400)) || return 0
  if [[ -f $OFFSITE_STATE_DIR/read-check-slot && ! -L $OFFSITE_STATE_DIR/read-check-slot ]]; then
    letzter_slot=$(<"$OFFSITE_STATE_DIR/read-check-slot")
    [[ $letzter_slot =~ ^[0-9]+$ ]] || letzter_slot=0
  fi
  pruef_slot=$((letzter_slot % OFFSITE_READ_SLICES + 1))
  {
    printf '\nRepository-Pruefung: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
    if ((OFFSITE_READ_SLICES == 1)); then
      restic_sicher -r "$OFFSITE_REPOSITORY" --password-file "$OFFSITE_PASSWORD_FILE" \
        check --read-data
    else
      restic_sicher -r "$OFFSITE_REPOSITORY" --password-file "$OFFSITE_PASSWORD_FILE" \
        check --read-data-subset "${pruef_slot}/${OFFSITE_READ_SLICES}"
    fi
  } >> "${snapshot}.offsite.log" 2>&1 || return 77
  probe=$(mktemp "$OFFSITE_STATE_DIR/.restore-probe.XXXXXXXX")
  manifest_remote=$(mktemp "$OFFSITE_STATE_DIR/.manifest-probe.XXXXXXXX")
  manifest_sha_remote=$(mktemp "$OFFSITE_STATE_DIR/.manifest-sha-probe.XXXXXXXX")
  if restic_sicher -r "$OFFSITE_REPOSITORY" --password-file "$OFFSITE_PASSWORD_FILE" \
    dump "$snapshot_id" "$snapshot/STATUS.txt" > "$probe" 2>> "${snapshot}.offsite.log"; then
    rc=0
  else
    rc=$?
  fi
  if ((rc != 0)) || ! grep -qx 'VOLLSTAENDIG' "$probe"; then
    rm -f -- "$probe" "$manifest_remote" "$manifest_sha_remote"
    return 77
  fi
  if ! restic_sicher -r "$OFFSITE_REPOSITORY" --password-file "$OFFSITE_PASSWORD_FILE" \
      dump "$snapshot_id" "$snapshot/MANIFEST.tsv" > "$manifest_remote" 2>> "${snapshot}.offsite.log" ||
     ! restic_sicher -r "$OFFSITE_REPOSITORY" --password-file "$OFFSITE_PASSWORD_FILE" \
      dump "$snapshot_id" "$snapshot/MANIFEST.tsv.sha256" > "$manifest_sha_remote" 2>> "${snapshot}.offsite.log"; then
    rm -f -- "$probe" "$manifest_remote" "$manifest_sha_remote"
    return 77
  fi
  read -r sample < "$manifest_sha_remote" || sample=
  sample=$(printf '%s' "$sample" | tr 'A-F' 'a-f')
  if [[ ! $sample =~ ^[0-9a-f]{64}$ ||
        $(sha_datei "$manifest_remote" | tr 'A-F' 'a-f') != "$sample" ]]; then
    rm -f -- "$probe" "$manifest_remote" "$manifest_sha_remote"
    return 77
  fi
  # Eine kleine echte Nutzdatei derselben Restic-Snapshot-ID wird vollständig
  # gelesen und gegen den manifestierten SHA-256 geprüft.
  sample=
  while IFS=$'\t' read -r sample_hash sample_size sample_b64; do
    [[ $sample_hash =~ ^[0-9a-fA-F]{64}$ && $sample_size =~ ^[0-9]+$ &&
       $sample_size -le 1048576 && -n $sample_b64 ]] || continue
    b64_nach_variable sample_rel "$sample_b64" || continue
    manifest_pfad_sicher "$sample_rel" || continue
    [[ $sample_rel != STATUS.txt ]] || continue
    sample=ja
    break
  done < "$manifest_remote"
  if [[ $sample != ja ]]; then
    rm -f -- "$probe" "$manifest_remote" "$manifest_sha_remote"
    return 77
  fi
  sample_file=$(mktemp "$OFFSITE_STATE_DIR/.content-probe.XXXXXXXX")
  if ! restic_sicher -r "$OFFSITE_REPOSITORY" --password-file "$OFFSITE_PASSWORD_FILE" \
      dump "$snapshot_id" "$snapshot/$sample_rel" > "$sample_file" 2>> "${snapshot}.offsite.log" ||
     [[ $(wc -c < "$sample_file" | tr -d ' ') != "$sample_size" ]] ||
     [[ $(sha_datei "$sample_file" | tr 'A-F' 'a-f') != \
        $(printf '%s' "$sample_hash" | tr 'A-F' 'a-f') ]]; then
    rm -f -- "$probe" "$manifest_remote" "$manifest_sha_remote" "$sample_file"
    return 77
  fi
  rm -f -- "$probe" "$manifest_remote" "$manifest_sha_remote" "$sample_file"
  temp_check=$(mktemp "$OFFSITE_STATE_DIR/.last-check.XXXXXXXX")
  printf '%s\n' "$now" > "$temp_check"
  mv -- "$temp_check" "$OFFSITE_STATE_DIR/last-check-epoch"
  temp_slot=$(mktemp "$OFFSITE_STATE_DIR/.read-check-slot.XXXXXXXX")
  printf '%s\n' "$pruef_slot" > "$temp_slot"
  mv -- "$temp_slot" "$OFFSITE_STATE_DIR/read-check-slot"
  dauerhaft_synchronisieren "$OFFSITE_STATE_DIR/last-check-epoch" \
    "$OFFSITE_STATE_DIR/read-check-slot" "$OFFSITE_STATE_DIR" || return 77
  printf 'OFFSITE_CHECK=OK SNAPSHOT_ID=%s READ_SLICE=%d/%d\n' \
    "$snapshot_id" "$pruef_slot" "$OFFSITE_READ_SLICES"
}

offsite_uebertragen() {
  local snapshot=$1 art=${2:-neu} log rc json snapshot_id
  log=${snapshot}.offsite.log
  if [[ $art == neu ]]; then
    [[ -f ${snapshot}.offsite-pending && ! -L ${snapshot}.offsite-pending ]] || {
      printf 'OFFSITE=FEHLER GRUND=PENDING_FEHLT SNAPSHOT=%s\n' "$snapshot" >&2
      return 74
    }
    {
      printf 'Beginn: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
      printf 'Modus: restic (authentifiziert verschluesselt)\n'
      printf 'Tag: %s\n' "$OFFSITE_TAG"
      printf 'Restic-Job-Tag: %s\n' "$OFFSITE_JOB_TAG"
    } > "$log"
  else
    {
      printf '\nWiederaufnahme: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
      printf 'Der vorhandene, manifestgepruefte Snapshot wird erneut uebertragen.\n'
    } >> "$log"
  fi
  json=$(mktemp "$OFFSITE_STATE_DIR/.restic-output.XXXXXXXX")
  if restic_sicher -r "$OFFSITE_REPOSITORY" --password-file "$OFFSITE_PASSWORD_FILE" \
    backup --json --tag "$OFFSITE_TAG" --tag "$OFFSITE_JOB_TAG" -- \
    "$snapshot" > "$json" 2>> "$log"; then
    rc=0
  else
    rc=$?
  fi
  cat "$json" >> "$log"
  if ((rc != 0)); then
    rm -f -- "$json"
    offsite_status_schreiben "$snapshot" FEHLER "$rc" || return 74
    printf 'OFFSITE=FEHLER SNAPSHOT=%s LOG=%s\n' "$snapshot" "$log" >&2
    return 75
  fi
  snapshot_id=$(restic_snapshot_id "$json" 2>/dev/null || true)
  rm -f -- "$json"
  if [[ -z $snapshot_id ]]; then
    offsite_status_schreiben "$snapshot" FEHLER 78 || return 74
    printf 'OFFSITE=FEHLER GRUND=SNAPSHOT_ID_FEHLT SNAPSHOT=%s LOG=%s\n' "$snapshot" "$log" >&2
    return 78
  fi
  if ! offsite_pruefen_falls_faellig "$snapshot" "$snapshot_id"; then
    offsite_status_schreiben "$snapshot" FEHLER 77 "$snapshot_id" || return 74
    printf 'OFFSITE=FEHLER GRUND=REPOSITORY_PRUEFUNG SNAPSHOT_ID=%s LOG=%s\n' "$snapshot_id" "$log" >&2
    return 77
  fi
  offsite_status_schreiben "$snapshot" OK 0 "$snapshot_id" || return 74
  rm -f -- "${snapshot}.offsite-pending"
  dauerhaft_synchronisieren "$ZIEL_BASIS" || return 74
  printf 'OFFSITE=OK MODUS=restic SNAPSHOT=%s SNAPSHOT_ID=%s RESUME=%s\n' \
    "$snapshot" "$snapshot_id" "$([[ $art == resume ]] && printf 1 || printf 0)"
  return 0
}

pending_wert() {
  sidecar_wert "$@"
}

offsite_pending_reparieren() {
  local snapshot basis repariert=0 status status_job status_profile
  [[ $OFFSITE_MODE == restic ]] || return 0
  for snapshot in "$ZIEL_BASIS"/Gesamtsicherung_*; do
    [[ -d $snapshot && ! -L $snapshot ]] || continue
    basis=${snapshot##*/}
    [[ $basis =~ ^Gesamtsicherung_[0-9]{8}_[0-9]{6}(_[[:alnum:]_.-]+)?$ ]] || continue
    snapshot_gehoert_job "$snapshot" || continue
    pruefe_snapshot_manifest "$snapshot" || continue
    if [[ -e ${snapshot}.offsite-abandoned ]]; then
      if offsite_abandoned_valide "$snapshot"; then
        printf 'HINWEIS=OFFSITE_ABANDONED_NICHT_REAKTIVIERT SNAPSHOT=%s\n' "$basis"
        continue
      fi
      printf 'WARNUNG=OFFSITE_ABANDONED_UNGUELTIG SNAPSHOT=%s\n' "$basis" >&2
      return 74
    fi
    [[ ! -e ${snapshot}.offsite-pending ]] || continue
    status=${snapshot}.offsite-status
    if [[ -f $status && ! -L $status ]]; then
      status_job=$(sed -n 's/^Job-ID: //p' "$status")
      status_profile=$(sed -n 's/^Profil-SHA-256: //p' "$status")
      # Ein ausdrücklich zu einem anderen Profil gehörender Status ist kein
      # Crashfenster dieses Profils. Sonst würde ein Profilwechsel historische
      # Generationen ungefragt in ein anderes Repository umhängen.
      [[ $status_job == "$JOB_ID" && $status_profile == "$OFFSITE_PROFILE_SHA" ]] ||
        continue
    fi
    offsite_status_positiv "$snapshot" && continue
    offsite_pending_schreiben "$snapshot" || return 74
    repariert=$((repariert + 1))
    printf 'WARNUNG=OFFSITE_PENDING_REKONSTRUIERT SNAPSHOT=%s\n' "$basis" >&2
  done
  ((repariert == 0)) || printf 'OFFSITE_PENDING_REPARIERT=%d\n' "$repariert"
}

offsite_pending_fortsetzen() {
  local liste pending basis snapshot format state_snapshot manifest_sha profile_sha ist_manifest
  local state_job target_id rc fortgesetzt=0
  [[ $OFFSITE_MODE == restic ]] || return 0
  liste=$(mktemp "$ZIEL_BASIS/.offsite-resume.XXXXXXXX")
  : > "$liste"
  for pending in "$ZIEL_BASIS"/Gesamtsicherung_*.offsite-pending; do
    [[ -f $pending && ! -L $pending ]] || continue
    basis=${pending##*/}
    [[ $basis =~ ^Gesamtsicherung_[0-9]{8}_[0-9]{6}(_[[:alnum:]_.-]+)?\.offsite-pending$ ]] ||
      continue
    printf '%s\n' "$pending" >> "$liste"
  done
  LC_ALL=C sort "$liste" -o "$liste"
  while IFS= read -r pending; do
    basis=${pending##*/}
    snapshot=${pending%.offsite-pending}
    if [[ -e ${snapshot}.offsite-abandoned ]]; then
      if offsite_abandoned_valide "$snapshot"; then
        printf 'HINWEIS=OFFSITE_ABANDONED_PENDING_IGNORIERT SNAPSHOT=%s\n' \
          "${snapshot##*/}"
        continue
      fi
      printf 'WARNUNG=OFFSITE_ABANDONED_UNGUELTIG SNAPSHOT=%s\n' \
        "${snapshot##*/}" >&2
      rm -f -- "$liste"
      return 74
    fi
    format=$(pending_wert "$pending" FORMAT 2>/dev/null || true)
    state_snapshot=$(pending_wert "$pending" SNAPSHOT 2>/dev/null || true)
    manifest_sha=$(pending_wert "$pending" MANIFEST_SHA 2>/dev/null || true)
    profile_sha=$(pending_wert "$pending" PROFILE_SHA 2>/dev/null || true)
    state_job=$(pending_wert "$pending" JOB_ID 2>/dev/null || true)
    target_id=$(pending_wert "$pending" TARGET_ID 2>/dev/null || true)
    # Zustände anderer Jobs oder Profile werden nie angefasst und können
    # deshalb weder diesen Lauf blockieren noch von seiner Retention betroffen sein.
    [[ $state_job == "$JOB_ID" && $profile_sha == "$OFFSITE_PROFILE_SHA" ]] || continue
    if [[ $format != Betreuungsbuero-Offsite-Pending/1 ||
          $state_snapshot != "${snapshot##*/}" ||
          ! $manifest_sha =~ ^[0-9a-fA-F]{64}$ ||
          $target_id != "${ZIEL_ID:-unmarkiert}" ]]; then
      mv -- "$pending" "$OFFSITE_STATE_DIR/quarantaene/${basis}.$(date +%s).ungueltig"
      printf 'WARNUNG=OFFSITE_PENDING_QUARANTAENE DATEI=%s\n' "$basis" >&2
      continue
    fi
    ist_manifest=$(sha_datei "$snapshot/MANIFEST.tsv" 2>/dev/null || true)
    ist_manifest=$(printf '%s' "$ist_manifest" | tr 'A-F' 'a-f')
    manifest_sha=$(printf '%s' "$manifest_sha" | tr 'A-F' 'a-f')
    if [[ $ist_manifest != "$manifest_sha" ]] ||
       ! pruefe_snapshot_manifest "$snapshot"; then
      mv -- "$pending" "$OFFSITE_STATE_DIR/quarantaene/${basis}.$(date +%s).manifest"
      printf 'WARNUNG=OFFSITE_PENDING_QUARANTAENE SNAPSHOT=%s GRUND=MANIFEST\n' \
        "${snapshot##*/}" >&2
      continue
    fi
    if offsite_uebertragen "$snapshot" resume; then
      rc=0
    else
      rc=$?
    fi
    if ((rc != 0)); then
      printf 'WARNUNG=OFFSITE_BACKLOG SNAPSHOT=%s\n' "${snapshot##*/}" >&2
      break
    fi
    fortgesetzt=$((fortgesetzt + 1))
    # Pro Hauptlauf höchstens eine ältere Generation nachholen; der frische
    # lokale Snapshot hat immer Vorrang und die Laufzeit bleibt begrenzt.
    ((fortgesetzt < 1)) || break
  done < "$liste"
  rm -f -- "$liste"
  printf 'OFFSITE_BACKLOG_VERARBEITET=%d\n' "$fortgesetzt"
  return 0
}

offsite_pending_begrenzen() {
  local liste pending state_job profile_sha anzahl=0 fremdprofil=0
  [[ $OFFSITE_MODE == restic ]] || return 0
  liste=$(mktemp "$ZIEL_BASIS/.offsite-limit.XXXXXXXX")
  : > "$liste"
  for pending in "$ZIEL_BASIS"/Gesamtsicherung_*.offsite-pending; do
    [[ -f $pending && ! -L $pending ]] || continue
    state_job=$(pending_wert "$pending" JOB_ID 2>/dev/null || true)
    profile_sha=$(pending_wert "$pending" PROFILE_SHA 2>/dev/null || true)
    [[ $state_job == "$JOB_ID" ]] || continue
    if [[ $profile_sha != "$OFFSITE_PROFILE_SHA" ]]; then
      fremdprofil=$((fremdprofil + 1))
      continue
    fi
    printf '%s\n' "$pending" >> "$liste"
  done
  LC_ALL=C sort -r "$liste" -o "$liste"
  while IFS= read -r pending; do
    [[ -n $pending ]] || continue
    anzahl=$((anzahl + 1))
  done < "$liste"
  rm -f -- "$liste"
  if ((anzahl > OFFSITE_MAX_PENDING)); then
    # Die Grenze ist eine Alarmgrenze, keine Löschberechtigung. Eine nie remote
    # bestätigte Generation verliert ihren Schutz nur durch eine bewusste,
    # restic-geprüfte Administratorentscheidung.
    printf 'WARNUNG=OFFSITE_PENDING_UEBERLAUF ANZAHL=%d MAX=%d KEINE_LOESCHUNG=1\n' \
      "$anzahl" "$OFFSITE_MAX_PENDING" >&2
  fi
  if ((fremdprofil > 0)); then
    printf 'WARNUNG=OFFSITE_PENDING_FREMDPROFIL ANZAHL=%d KEINE_LOESCHUNG=1\n' \
      "$fremdprofil" >&2
  fi
  printf 'OFFSITE_PENDING=%d MAX=%d\n' "$anzahl" "$OFFSITE_MAX_PENDING"
}

offsite_retention_anwenden() {
  [[ $OFFSITE_MODE == restic ]] || return 0
  ((RETENTION_DAILY > 0 || RETENTION_MONTHLY > 0 || RETENTION_YEARLY > 0)) || return 0
  # Harte Rechte-Trennung: Der normale Sicherungsprozess besitzt nur
  # append-only Upload-Rechte und ruft niemals restic forget/prune auf.
  # Die gesonderte Wartungsinstanz bindet ihren atomaren Statusbeleg an
  # Repository, Job-Tag und exakt diese Aufbewahrungsregel.
  printf 'OFFSITE_RETENTION=EXTERN DAILY=%d MONTHLY=%d YEARLY=%d JOB_TAG=%s\n' \
    "$RETENTION_DAILY" "$RETENTION_MONTHLY" "$RETENTION_YEARLY" "$OFFSITE_JOB_TAG"
}

offsite_pending_nur_fortsetzen() {
  local liste pending basis snapshot format state_snapshot manifest_sha profile_sha
  local state_job target_id ist_manifest rc angefordert
  angefordert=$ZIEL_BASIS/$RESUME_SNAPSHOT_NAME
  if [[ -e ${angefordert}.offsite-abandoned ]]; then
    if offsite_abandoned_valide "$angefordert"; then
      printf 'HINWEIS=OFFSITE_ABANDONED_NICHT_FORTGESETZT SNAPSHOT=%s\n' \
        "$RESUME_SNAPSHOT_NAME"
      printf 'LOCAL_COMPLETE=1\nOFFSITE_PENDING=0\n'
      return 3
    fi
    printf 'WARNUNG=OFFSITE_ABANDONED_UNGUELTIG SNAPSHOT=%s\n' \
      "$RESUME_SNAPSHOT_NAME" >&2
    return 74
  fi
  liste=$(mktemp "$ZIEL_BASIS/.offsite-only.XXXXXXXX")
  : > "$liste"
  for pending in "$ZIEL_BASIS"/Gesamtsicherung_*.offsite-pending; do
    [[ -f $pending && ! -L $pending ]] || continue
    printf '%s\n' "$pending" >> "$liste"
  done
  LC_ALL=C sort "$liste" -o "$liste"
  while IFS= read -r pending; do
    [[ -n $pending ]] || continue
    basis=${pending##*/}
    snapshot=${pending%.offsite-pending}
    [[ $basis =~ ^Gesamtsicherung_[0-9]{8}_[0-9]{6}(_[[:alnum:]_.-]+)?\.offsite-pending$ ]] ||
      continue
    [[ ${snapshot##*/} == "$RESUME_SNAPSHOT_NAME" ]] || continue
    if [[ -e ${snapshot}.offsite-abandoned ]]; then
      if offsite_abandoned_valide "$snapshot"; then
        printf 'HINWEIS=OFFSITE_ABANDONED_NICHT_FORTGESETZT SNAPSHOT=%s\n' \
          "${snapshot##*/}"
        rm -f -- "$liste"
        printf 'LOCAL_COMPLETE=1\nOFFSITE_PENDING=0\n'
        return 3
      fi
      printf 'WARNUNG=OFFSITE_ABANDONED_UNGUELTIG SNAPSHOT=%s\n' \
        "${snapshot##*/}" >&2
      rm -f -- "$liste"
      return 74
    fi
    format=$(pending_wert "$pending" FORMAT 2>/dev/null || true)
    state_snapshot=$(pending_wert "$pending" SNAPSHOT 2>/dev/null || true)
    manifest_sha=$(pending_wert "$pending" MANIFEST_SHA 2>/dev/null || true)
    profile_sha=$(pending_wert "$pending" PROFILE_SHA 2>/dev/null || true)
    state_job=$(pending_wert "$pending" JOB_ID 2>/dev/null || true)
    target_id=$(pending_wert "$pending" TARGET_ID 2>/dev/null || true)
    [[ $state_job == "$JOB_ID" && $profile_sha == "$OFFSITE_PROFILE_SHA" &&
       $target_id == "${ZIEL_ID:-unmarkiert}" ]] || continue
    if [[ $format != Betreuungsbuero-Offsite-Pending/1 ||
          $state_snapshot != "${snapshot##*/}" ||
          ! $manifest_sha =~ ^[0-9a-fA-F]{64}$ ]]; then
      mv -- "$pending" "$OFFSITE_STATE_DIR/quarantaene/${basis}.$(date +%s).ungueltig"
      printf 'WARNUNG=OFFSITE_PENDING_QUARANTAENE DATEI=%s\n' "$basis" >&2
      continue
    fi
    ist_manifest=$(sha_datei "$snapshot/MANIFEST.tsv" 2>/dev/null || true)
    ist_manifest=$(printf '%s' "$ist_manifest" | tr 'A-F' 'a-f')
    manifest_sha=$(printf '%s' "$manifest_sha" | tr 'A-F' 'a-f')
    if [[ $ist_manifest != "$manifest_sha" ]] ||
       ! snapshot_gehoert_job "$snapshot" ||
       ! pruefe_snapshot_manifest "$snapshot"; then
      mv -- "$pending" "$OFFSITE_STATE_DIR/quarantaene/${basis}.$(date +%s).manifest"
      printf 'WARNUNG=OFFSITE_PENDING_QUARANTAENE SNAPSHOT=%s GRUND=MANIFEST_JOB\n' \
        "${snapshot##*/}" >&2
      continue
    fi
    # Erst nach der vollständigen lokalen Prüfung darf der Runner seine
    # Schreibbarriere freigeben. Es wird ausdrücklich keine neue Generation
    # angelegt.
    printf 'LOCAL_COMPLETE=1\n'
    printf 'OFFSITE_PENDING=1\n'
    printf 'RESUME_SNAPSHOT=%s\n' "$snapshot"
    if offsite_uebertragen "$snapshot" resume; then
      rc=0
    else
      rc=$?
    fi
    rm -f -- "$liste"
    if ((rc != 0)); then
      printf 'LOCAL_COMPLETE=1\n'
      printf 'OFFSITE_PENDING=1\n'
      return "$rc"
    fi
    offsite_retention_anwenden
    offsite_pending_begrenzen
    printf 'LOCAL_COMPLETE=1\n'
    printf 'OFFSITE_PENDING_FOR_SNAPSHOT=0\n'
    return 0
  done < "$liste"
  rm -f -- "$liste"
  printf 'LOCAL_COMPLETE=0\n'
  printf 'OFFSITE_PENDING=0\n'
  return 3
}

if [[ $OFFSITE_MODE == restic ]]; then
  # Repariert insbesondere das harte Crashfenster eines älteren Builds, in dem
  # der lokale Snapshot bereits veröffentlicht, der Pending-Zustand aber noch
  # nicht geschrieben war. Keine vollständige Generation wird dadurch still
  # von der Remote-Warteschlange ausgeschlossen.
  if (( ! RESUME_OFFSITE_ONLY )); then
    offsite_pending_reparieren
  fi
  offsite_pending_begrenzen
fi
if ((RESUME_OFFSITE_ONLY)); then
  if offsite_pending_nur_fortsetzen; then
    exit 0
  else
    RESUME_RC=$?
    exit "$RESUME_RC"
  fi
fi

sql_hat_tabelle() {
  local anzahl
  if ! anzahl=$(sqlite3 -batch -noheader "$1" \
    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$2';"); then
    befund "SQLite-Schemaabfrage fuer Tabelle '$2' ist fehlgeschlagen; die Tabelle wird nicht still als fehlend gewertet."
    return 1
  fi
  [[ $anzahl == 1 ]]
}

sql_hat_spalte() {
  local anzahl
  if ! anzahl=$(sqlite3 -batch -noheader "$1" \
    "SELECT count(*) FROM pragma_table_info('$2') WHERE name='$3';"); then
    befund "SQLite-Schemaabfrage fuer Spalte '$2.$3' ist fehlgeschlagen; die Spalte wird nicht still als fehlend gewertet."
    return 1
  fi
  [[ $anzahl == 1 ]]
}

# Liest ausschließlich die physischen Dokumentwurzeln aus einer angegebenen
# SQLite-Datei. Dieselbe Abfrage läuft unmittelbar vor `.backup` gegen die
# Live-DB und danach gegen die Sicherungskopie. Damit kann eine während der
# DB-Sicherung geänderte Ablagekonfiguration nicht unbemerkt zu einem
# zeitlich gemischten Snapshot führen.
documents_config_zeilen() {
  local datenbank=$1 ausgabe=$2 tabellen config_status
  if ! tabellen=$(sqlite3 -batch -noheader -cmd '.timeout 30000' "$datenbank" \
      "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='office_json';"); then
    return 2
  fi
  [[ $tabellen == 0 || $tabellen == 1 ]] || return 2
  if [[ $tabellen == 0 ]]; then
    : > "$ausgabe"
    return 0
  fi
  if ! config_status=$(sqlite3 -batch -noheader -cmd '.timeout 30000' "$datenbank" "
      SELECT count(*)||'|'||
             COALESCE(sum(CASE
               WHEN json_valid(data_json) AND json_type(data_json)='object' THEN 1
               ELSE 0 END),0)
        FROM office_json
       WHERE key='documents_config';"); then
    return 2
  fi
  case "$config_status" in
    '0|0')
      : > "$ausgabe"
      return 0
      ;;
    '1|1')
      ;;
    *)
      return 2
      ;;
  esac
  sqlite3 -batch -noheader -cmd '.timeout 30000' "$datenbank" "
    WITH cfg(j) AS (
      SELECT data_json
        FROM office_json WHERE key='documents_config' LIMIT 1
    ), roots(ord,art,id_hex,pfad_hex) AS (
      SELECT 0,'STORAGE','',hex(CAST(json_extract(j, '\$.storageRoot') AS TEXT))
        FROM cfg
       WHERE typeof(json_extract(j, '\$.storageRoot'))='text'
         AND json_extract(j, '\$.storageRoot')!=''
      UNION ALL
      SELECT 1,'BASE','',hex(CAST(json_extract(j, '\$.baseDir') AS TEXT))
        FROM cfg
       WHERE typeof(json_extract(j, '\$.baseDir'))='text'
         AND json_extract(j, '\$.baseDir')!=''
      UNION ALL
      SELECT 2,'CASE',hex(CAST(e.key AS TEXT)),hex(CAST(e.value AS TEXT))
        FROM cfg, json_each(CASE
          WHEN json_type(j, '\$.caseDirs')='object' THEN json_extract(j, '\$.caseDirs')
          ELSE '{}' END) AS e
       WHERE typeof(e.value)='text' AND e.value!=''
    )
    SELECT art||'|'||id_hex||'|'||pfad_hex
      FROM roots ORDER BY ord,art,id_hex;" > "$ausgabe"
}

# Bash wartet bei einer Process Substitution nicht auf den Erzeuger und reicht
# dessen Rückgabecode nicht an die umgebende while-Schleife weiter. Jede
# SQLite-Aufzählung wird deshalb zuerst vollständig in eine reguläre Datei
# geschrieben. Ein SQL-/Schemafehler macht den Snapshot sichtbar
# UNVOLLSTAENDIG, statt wie eine leere Ergebnismenge auszusehen.
sqlite_zeilen_datei() {
  local beschreibung=$1 sql=$2 ausgabe=$3
  if sqlite3 -batch -noheader "$DB_KOPIE" "$sql" > "$ausgabe"; then
    return 0
  fi
  : > "$ausgabe"
  befund "SQLite-Pruefabfrage '$beschreibung' ist fehlgeschlagen; die betroffenen Dateien wurden nicht still ausgelassen."
  return 1
}

sqlite_backup() {
  local quelle=$1 ziel=$2 q
  q=${ziel//\\/\\\\}
  q=${q//\"/\\\"}
  {
    printf '.timeout 30000\n'
    printf '.backup "%s"\n' "$q"
  } | sqlite3 -batch "$quelle"
}

baum_signatur() {
  node - "$@" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const excluded = new Set(process.argv.slice(3).map((value) =>
  String(value).replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
).filter(Boolean));
const retryable = new Set(['ENOENT', 'ESTALE', 'EAGAIN', 'EBUSY']);
function calculate() {
  const hash = crypto.createHash('sha256');
  function walk(dir, rel) {
    const names = fs.readdirSync(dir)
      .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
    for (const name of names) {
      const abs = path.join(dir, name);
      const child = rel ? path.posix.join(rel, name) : name;
      if (excluded.has(child)) continue;
      const st = fs.lstatSync(abs, { bigint: true });
      const kind = st.isDirectory() ? 'd' : st.isFile() ? 'f' : st.isSymbolicLink() ? 'l' : 'x';
      hash.update([
        kind, child, String(st.size), String(st.mode), String(st.mtimeNs),
        String(st.ctimeNs), String(st.ino), String(st.dev)
      ].join('\0') + '\n');
      if (kind === 'f') {
        let fd;
        try {
          fd = fs.openSync(abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
          const before = fs.fstatSync(fd, { bigint: true });
          if (!before.isFile() || before.dev !== st.dev || before.ino !== st.ino) {
            const error = new Error(`Datei wurde zwischen lstat und open ausgetauscht: ${child}`);
            error.code = 'EAGAIN';
            throw error;
          }
          const content = crypto.createHash('sha256');
          const buffer = Buffer.allocUnsafe(1024 * 1024);
          let read;
          while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
            content.update(buffer.subarray(0, read));
          }
          const after = fs.fstatSync(fd, { bigint: true });
          for (const field of ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs']) {
            if (before[field] !== after[field]) {
              const error = new Error(`Datei wurde waehrend des Hashens geaendert: ${child}`);
              error.code = 'EAGAIN';
              throw error;
            }
          }
          hash.update('CONTENT\0');
          hash.update(content.digest());
          hash.update('\n');
        } finally {
          if (fd !== undefined) fs.closeSync(fd);
        }
      } else if (kind === 'l') {
        hash.update('LINK\0' + fs.readlinkSync(abs) + '\n');
      } else if (kind === 'd') {
        walk(abs, child);
      }
    }
  }
  walk(root, '');
  return hash.digest('hex');
}
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    process.stdout.write(calculate());
    process.exit(0);
  } catch (error) {
    if (attempt === 3 || !retryable.has(error && error.code)) {
      console.error(`Baumsignatur fehlgeschlagen (${error && error.code || 'unbekannt'}): ${error && error.message || error}`);
      process.exit(2);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 25);
  }
}
NODE
}

kopiere_baum() {
  local quelle=$1 ziel=$2
  shift 2
  mkdir -p -- "$ziel"
  tar -C "$quelle" "$@" -cf - . | tar -C "$ziel" -xf -
}

wurzel_ausnahmen_setzen() {
  local wurzel=$1 db_rel
  WURZEL_TAR_AUSNAHMEN=()
  WURZEL_SIGNATUR_AUSNAHMEN=()
  if [[ $DB_QUELLE == "$wurzel/"* ]]; then
    db_rel=${DB_QUELLE#"$wurzel/"}
    WURZEL_TAR_AUSNAHMEN+=(--exclude="./$db_rel" --exclude="./$db_rel-wal" --exclude="./$db_rel-shm")
    WURZEL_SIGNATUR_AUSNAHMEN+=("$db_rel" "$db_rel-wal" "$db_rel-shm")
  fi
}

config_signatur_vorher_laden() {
  local gesucht=$1 pfad_hex status
  CONFIG_SIGNATUR_VORHER=
  while IFS='|' read -r pfad_hex status; do
    if [[ $pfad_hex == "$gesucht" ]]; then
      CONFIG_SIGNATUR_VORHER=$status
      return 0
    fi
  done < "$CONFIG_SIGNATUREN_LIVE"
  return 1
}

# Der Konsistenzzaun aller aus documents_config referenzierten physischen
# Wurzeln beginnt vor SQLite `.backup`. Sonst könnte genau während der
# DB-Sicherung eine Datei geändert werden und der erst danach beginnende
# Wurzelvergleich würde den Mischstand fälschlich bestätigen.
CONFIG_ZEILEN_LIVE=$STAGE/verwaltung/.config-wurzeln-live
CONFIG_SIGNATUREN_LIVE=$STAGE/verwaltung/.config-signaturen-live
: > "$CONFIG_SIGNATUREN_LIVE"
if ! documents_config_zeilen "$DB_QUELLE" "$CONFIG_ZEILEN_LIVE"; then
  printf '%s: documents_config konnte vor der SQLite-Sicherung nicht stabil gelesen werden.\n' \
    "$PROGRAMM" >&2
  exit 2
fi
while IFS='|' read -r LIVE_ART LIVE_ID_HEX LIVE_PFAD_HEX; do
  [[ -n ${LIVE_ART:-} && -n ${LIVE_PFAD_HEX:-} ]] || continue
  hex_nach_variable LIVE_PFAD "$LIVE_PFAD_HEX"
  if enthaelt_steuerzeichen "$LIVE_PFAD"; then
    befund "Eine konfigurierte Dokumentwurzel enthaelt Tabulator oder Zeilenumbruch."
    continue
  fi
  if [[ $LIVE_PFAD != /* ]]; then
    LIVE_PFAD=$SERVER_DIR/$LIVE_PFAD
  fi
  if [[ ! -d $LIVE_PFAD ]]; then
    LIVE_PFAD_HEX_KANON=$(hex "$LIVE_PFAD")
    if ! config_signatur_vorher_laden "$LIVE_PFAD_HEX_KANON"; then
      printf '%s|FEHLT\n' "$LIVE_PFAD_HEX_KANON" >> "$CONFIG_SIGNATUREN_LIVE"
    fi
    continue
  fi
  LIVE_PFAD=$(kanon_ordner "$LIVE_PFAD")
  LIVE_PFAD_HEX_KANON=$(hex "$LIVE_PFAD")
  if config_signatur_vorher_laden "$LIVE_PFAD_HEX_KANON"; then
    continue
  fi
  if [[ $LIVE_PFAD == / ]]; then
    printf '%s|UNGUELTIG\n' "$LIVE_PFAD_HEX_KANON" >> "$CONFIG_SIGNATUREN_LIVE"
    continue
  fi
  if ist_unterhalb "$ZIEL_BASIS" "$LIVE_PFAD"; then
    printf '%s: Sicherungsziel liegt in konfigurierter Dokumentwurzel: %s\n' \
      "$PROGRAMM" "$LIVE_PFAD" >&2
    exit 71
  fi
  if ist_unterhalb "$LIVE_PFAD" "$ZIEL_BASIS"; then
    printf '%s: Konfigurierte Dokumentwurzel liegt im Sicherungsziel; Quelle und Ziel ueberlappen: %s\n' \
      "$PROGRAMM" "$LIVE_PFAD" >&2
    exit 71
  fi
  if [[ -n $OFFSITE_PASSWORD_FILE ]] &&
     ist_unterhalb "$OFFSITE_PASSWORD_FILE" "$LIVE_PFAD"; then
    fehler "Die restic-Passwortdatei darf nicht in einer konfigurierten Dokumentwurzel liegen."
  fi
  wurzel_ausnahmen_setzen "$LIVE_PFAD"
  if ((${#WURZEL_SIGNATUR_AUSNAHMEN[@]})); then
    LIVE_SIGNATUR=$(baum_signatur "$LIVE_PFAD" \
      "${WURZEL_SIGNATUR_AUSNAHMEN[@]}") || LIVE_SIGNATUR=
  else
    LIVE_SIGNATUR=$(baum_signatur "$LIVE_PFAD") || LIVE_SIGNATUR=
  fi
  if [[ ! $LIVE_SIGNATUR =~ ^[0-9a-f]{64}$ ]]; then
    printf '%s: Externe Dokumentwurzel konnte vor der SQLite-Sicherung nicht stabil gelesen werden: %s\n' \
      "$PROGRAMM" "$LIVE_PFAD" >&2
    exit 2
  fi
  printf '%s|%s\n' "$LIVE_PFAD_HEX_KANON" "$LIVE_SIGNATUR" >> "$CONFIG_SIGNATUREN_LIVE"
done < "$CONFIG_ZEILEN_LIVE"

# Signatur und tar müssen exakt dieselben relativen Live-DB-Dateien
# ausschließen. Andernfalls würde eine reine WAL-Aktivität einen falschen
# Mischstand melden oder die Konsistenzprüfung einen kopierten Pfad bewerten,
# der im Snapshot absichtlich gar nicht existiert.
wurzel_ausnahmen_setzen "$DATEN_QUELLE"
TAR_AUSNAHMEN=()
SIGNATUR_AUSNAHMEN=()
if ((${#WURZEL_TAR_AUSNAHMEN[@]})); then
  TAR_AUSNAHMEN=("${WURZEL_TAR_AUSNAHMEN[@]}")
  SIGNATUR_AUSNAHMEN=("${WURZEL_SIGNATUR_AUSNAHMEN[@]}")
fi
if ((${#TAR_AUSNAHMEN[@]})); then
  hinweis "Live-DB, WAL und SHM wurden beim Dateibaum und seiner Signatur ausgeschlossen."
fi
if ((${#SIGNATUR_AUSNAHMEN[@]})); then
  DATA_SIGNATUR_VORHER=$(baum_signatur "$DATEN_QUELLE" \
    "${SIGNATUR_AUSNAHMEN[@]}") || DATA_SIGNATUR_VORHER=
else
  DATA_SIGNATUR_VORHER=$(baum_signatur "$DATEN_QUELLE") || DATA_SIGNATUR_VORHER=
fi
if [[ ! $DATA_SIGNATUR_VORHER =~ ^[0-9a-f]{64}$ ]]; then
  printf '%s: Datenbaum konnte wegen einer Dateisystem-Race nicht stabil gelesen werden.\n' "$PROGRAMM" >&2
  exit 2
fi
DB_KOPIE=$STAGE/datenbank/betreuungsbuero.sqlite3
sqlite_backup "$DB_QUELLE" "$DB_KOPIE"
# `.backup` übernimmt den Journalmodus der Quelle. Bei einer WAL-Quelldatenbank
# würden selbst rein lesende Prüfungen an der eigenständigen Kopie sonst neue
# `-shm`/`-wal`-Sidecars im Snapshot erzeugen. Die Sicherungskopie wird daher
# noch vor allen Auswertungen mit SQLite selbst in den portablen DELETE-Modus
# überführt; die Nutzdaten waren durch `.backup` bereits konsistent eingecheckt.
DB_JOURNAL_MODE=$(sqlite3 -batch -noheader "$DB_KOPIE" 'PRAGMA journal_mode=DELETE;')
[[ $(printf '%s' "$DB_JOURNAL_MODE" | tr '[:upper:]' '[:lower:]') == delete ]] ||
  { printf '%s: SQLite-Sicherungskopie konnte nicht in den portablen Journalmodus versetzt werden.\n' \
      "$PROGRAMM" >&2; exit 74; }
# SQLite kann beim Wechsel von WAL auf DELETE eine reine Shared-Memory-Datei
# zurücklassen. Sie enthält keine Nutzdaten und gehört nicht zur portablen
# Kopie. Ein verbliebenes WAL wäre dagegen fachlich relevant und ist ein Fehler.
[[ ! -e $DB_KOPIE-wal ]] ||
  { printf '%s: SQLite-Sicherungskopie besitzt nach dem Journalwechsel noch ein WAL.\n' \
      "$PROGRAMM" >&2; exit 74; }
rm -f -- "$DB_KOPIE-shm"
[[ ! -e $DB_KOPIE-wal && ! -e $DB_KOPIE-shm ]] ||
  { printf '%s: SQLite-Sicherungskopie besitzt unerwartete Journal-Sidecars.\n' \
      "$PROGRAMM" >&2; exit 74; }
INTEGRITAET=$(sqlite3 -batch -noheader "$DB_KOPIE" 'PRAGMA integrity_check;')
if [[ $INTEGRITAET != ok ]]; then
  printf '%s: SQLite-Sicherung ist nicht integer: %s\n' "$PROGRAMM" "$INTEGRITAET" >&2
  exit 70
fi
if ! FK_FEHLER=$(sqlite3 -batch -noheader "$DB_KOPIE" 'PRAGMA foreign_key_check;'); then
  printf '%s: PRAGMA foreign_key_check konnte nicht ausgefuehrt werden.\n' "$PROGRAMM" >&2
  exit 70
fi
if [[ -n $FK_FEHLER ]]; then
  printf '%s: SQLite-Sicherung hat Fremdschluesselverletzungen: %s\n' \
    "$PROGRAMM" "$(printf '%s' "$FK_FEHLER" | head -n 3 | tr '\n' ' ')" >&2
  exit 70
fi
hinweis "SQLite .backup abgeschlossen; PRAGMA integrity_check = ok; PRAGMA foreign_key_check = leer."

if ((${#TAR_AUSNAHMEN[@]})); then
  kopiere_baum "$DATEN_QUELLE" "$STAGE/inhalt/server-data" "${TAR_AUSNAHMEN[@]}" || {
    printf '%s: Dateibaum konnte wegen einer Quell-Race nicht vollständig kopiert werden.\n' "$PROGRAMM" >&2
    exit 2
  }
else
  kopiere_baum "$DATEN_QUELLE" "$STAGE/inhalt/server-data" || {
    printf '%s: Dateibaum konnte wegen einer Quell-Race nicht vollständig kopiert werden.\n' "$PROGRAMM" >&2
    exit 2
  }
fi
if ((${#SIGNATUR_AUSNAHMEN[@]})); then
  DATA_SIGNATUR_NACHHER=$(baum_signatur "$DATEN_QUELLE" \
    "${SIGNATUR_AUSNAHMEN[@]}") || DATA_SIGNATUR_NACHHER=
else
  DATA_SIGNATUR_NACHHER=$(baum_signatur "$DATEN_QUELLE") || DATA_SIGNATUR_NACHHER=
fi
if [[ ! $DATA_SIGNATUR_NACHHER =~ ^[0-9a-f]{64}$ ]]; then
  printf '%s: Datenbaum konnte nach der Kopie wegen einer Dateisystem-Race nicht stabil gelesen werden.\n' "$PROGRAMM" >&2
  exit 2
fi
if [[ $DATA_SIGNATUR_VORHER != "$DATA_SIGNATUR_NACHHER" ]]; then
  befund "Der Datenbaum hat sich zwischen SQLite-Sicherung und Dateikopie geaendert; dieser Mischstand wird nicht als vollstaendig bestaetigt."
else
  hinweis "Konsistenzzaun: Signatur des Datenbaums vor und nach der Kopie stimmt ueberein."
fi

DATA_HEX=$(hex "$DATEN_QUELLE")
DATA_ZIEL=inhalt/server-data
printf 'DATA||%s|%s\n' "$DATA_HEX" "$(hex "$DATA_ZIEL")" >> "$MAP"
printf 'intern\tserver-data\t%s\t%s\n' "$(b64 "$DATEN_QUELLE")" "$(b64 "$DATA_ZIEL")" >> "$WURZELN"

CONFIG_ZEILEN=$STAGE/verwaltung/.config-wurzeln
: > "$CONFIG_ZEILEN"
if ! documents_config_zeilen "$DB_KOPIE" "$CONFIG_ZEILEN"; then
  printf '%s: documents_config konnte aus der integren DB-Kopie nicht gelesen werden.\n' \
    "$PROGRAMM" >&2
  exit 70
fi
if ! cmp -s -- "$CONFIG_ZEILEN_LIVE" "$CONFIG_ZEILEN"; then
  printf '%s: documents_config hat sich waehrend der SQLite-Sicherung geaendert; der Mischstand wird erneut versucht.\n' \
    "$PROGRAMM" >&2
  exit 2
fi

EXTERN_NR=0
while IFS='|' read -r ART ID_HEX PFAD_HEX; do
  [[ -n ${ART:-} && -n ${PFAD_HEX:-} ]] || continue
  hex_nach_variable KONFIG_PFAD "$PFAD_HEX"
  if enthaelt_steuerzeichen "$KONFIG_PFAD"; then
    befund "Eine konfigurierte Dokumentwurzel enthaelt Tabulator oder Zeilenumbruch."
    continue
  fi
  if [[ $KONFIG_PFAD != /* ]]; then
    KONFIG_PFAD=$SERVER_DIR/$KONFIG_PFAD
  fi
  if [[ ! -d $KONFIG_PFAD ]]; then
    befund "Konfigurierte Dokumentwurzel fehlt: $KONFIG_PFAD"
    printf '%s\t%s\t%s\t\n' "$ART" "${ID_HEX:-base}" "$(b64 "$KONFIG_PFAD")" >> "$WURZELN"
    continue
  fi
  KONFIG_PFAD=$(kanon_ordner "$KONFIG_PFAD")
  if [[ $KONFIG_PFAD == / ]]; then
    befund "Die konfigurierte Dokumentwurzel '/' wird aus Sicherheitsgruenden nicht rekursiv gesichert."
    continue
  fi
  if ist_unterhalb "$ZIEL_BASIS" "$KONFIG_PFAD"; then
    printf '%s: Sicherungsziel liegt in konfigurierter Dokumentwurzel: %s\n' "$PROGRAMM" "$KONFIG_PFAD" >&2
    exit 71
  fi
  if ist_unterhalb "$KONFIG_PFAD" "$ZIEL_BASIS"; then
    printf '%s: Konfigurierte Dokumentwurzel liegt im Sicherungsziel; Quelle und Ziel ueberlappen: %s\n' \
      "$PROGRAMM" "$KONFIG_PFAD" >&2
    exit 71
  fi

  # Liegt die Wurzel bereits in einem kopierten Baum, wird nur eine zweite
  # Zuordnung eingetragen. So werden identische/untergeordnete storageRoot-,
  # baseDir- und caseDirs-Wurzeln nicht physisch dupliziert.
  GEFUNDEN_ZIEL=
  while IFS='|' read -r M_ART M_ID M_QUELLE_HEX M_ZIEL_HEX; do
    [[ -n ${M_QUELLE_HEX:-} ]] || continue
    hex_nach_variable M_QUELLE "$M_QUELLE_HEX"
    hex_nach_variable M_ZIEL "$M_ZIEL_HEX"
    if ist_unterhalb "$KONFIG_PFAD" "$M_QUELLE"; then
      REST=${KONFIG_PFAD#"$M_QUELLE"}
      REST=${REST#/}
      GEFUNDEN_ZIEL=$M_ZIEL
      [[ -z $REST ]] || GEFUNDEN_ZIEL=$GEFUNDEN_ZIEL/$REST
      break
    fi
  done < "$MAP"

  if [[ -z $GEFUNDEN_ZIEL ]]; then
    EXTERN_NR=$((EXTERN_NR + 1))
    printf -v NR '%03d' "$EXTERN_NR"
    GEFUNDEN_ZIEL=inhalt/externe-dokumentwurzeln/$NR
    wurzel_ausnahmen_setzen "$KONFIG_PFAD"
    EXTERN_AUSNAHMEN=()
    EXTERN_SIGNATUR_AUSNAHMEN=()
    if ((${#WURZEL_TAR_AUSNAHMEN[@]})); then
      EXTERN_AUSNAHMEN=("${WURZEL_TAR_AUSNAHMEN[@]}")
      EXTERN_SIGNATUR_AUSNAHMEN=("${WURZEL_SIGNATUR_AUSNAHMEN[@]}")
    fi
    if ((${#EXTERN_AUSNAHMEN[@]})); then
      hinweis "Live-DB, WAL und SHM wurden auch aus einer uebergeordneten externen Wurzel und ihrer Signatur ausgeschlossen."
    fi
    kapazitaet_fuer_zusatzwurzel_pruefen "$KONFIG_PFAD" "$ART:${ID_HEX:-base}"
    KONFIG_PFAD_HEX_KANON=$(hex "$KONFIG_PFAD")
    if ! config_signatur_vorher_laden "$KONFIG_PFAD_HEX_KANON" ||
       [[ ! $CONFIG_SIGNATUR_VORHER =~ ^[0-9a-f]{64}$ ]]; then
      printf '%s: Fuer die externe Dokumentwurzel fehlt eine gueltige Signatur von vor der SQLite-Sicherung: %s\n' \
        "$PROGRAMM" "$KONFIG_PFAD" >&2
      exit 2
    fi
    EXTERN_SIGNATUR_VORHER=$CONFIG_SIGNATUR_VORHER
    if ((${#EXTERN_AUSNAHMEN[@]})); then
      kopiere_baum "$KONFIG_PFAD" "$STAGE/$GEFUNDEN_ZIEL" "${EXTERN_AUSNAHMEN[@]}" || {
        printf '%s: Externe Dokumentwurzel konnte nicht vollständig kopiert werden: %s\n' \
          "$PROGRAMM" "$KONFIG_PFAD" >&2
        exit 2
      }
    else
      kopiere_baum "$KONFIG_PFAD" "$STAGE/$GEFUNDEN_ZIEL" || {
        printf '%s: Externe Dokumentwurzel konnte nicht vollständig kopiert werden: %s\n' \
          "$PROGRAMM" "$KONFIG_PFAD" >&2
        exit 2
      }
    fi
    if ((${#EXTERN_SIGNATUR_AUSNAHMEN[@]})); then
      EXTERN_SIGNATUR_NACHHER=$(baum_signatur "$KONFIG_PFAD" \
        "${EXTERN_SIGNATUR_AUSNAHMEN[@]}") || EXTERN_SIGNATUR_NACHHER=
    else
      EXTERN_SIGNATUR_NACHHER=$(baum_signatur "$KONFIG_PFAD") || EXTERN_SIGNATUR_NACHHER=
    fi
    if [[ ! $EXTERN_SIGNATUR_NACHHER =~ ^[0-9a-f]{64}$ ]]; then
      printf '%s: Externe Dokumentwurzel konnte nach der Kopie nicht stabil gelesen werden: %s\n' \
        "$PROGRAMM" "$KONFIG_PFAD" >&2
      exit 2
    fi
    if [[ $EXTERN_SIGNATUR_VORHER != "$EXTERN_SIGNATUR_NACHHER" ]]; then
      befund "Die externe Dokumentwurzel hat sich waehrend der Kopie geaendert: $KONFIG_PFAD"
    fi
  fi
  printf '%s|%s|%s|%s\n' "$ART" "${ID_HEX:-}" "$(hex "$KONFIG_PFAD")" "$(hex "$GEFUNDEN_ZIEL")" >> "$MAP"
  printf '%s\t%s\t%s\t%s\n' "$ART" "${ID_HEX:-base}" "$(b64 "$KONFIG_PFAD")" "$(b64 "$GEFUNDEN_ZIEL")" >> "$WURZELN"
done < "$CONFIG_ZEILEN"
rm -f -- "$CONFIG_ZEILEN" "$CONFIG_ZEILEN_LIVE" "$CONFIG_SIGNATUREN_LIVE"

map_ziel() {
  local art=$1 id=$2 a i qh zh
  MAP_ZIEL=
  while IFS='|' read -r a i qh zh; do
    if [[ $a == "$art" && $i == "$id" ]]; then
      hex_nach_variable MAP_ZIEL "$zh"
      return 0
    fi
  done < "$MAP"
  return 1
}

sicher_relativ() {
  local p=$1
  [[ -n $p && $p != /* ]] || return 1
  enthaelt_steuerzeichen "$p" && return 1
  case "/$p/" in
    */../*|*/./*) return 1 ;;
  esac
  return 0
}

id_sicher() {
  [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$ && $1 != . && $1 != .. ]]
}

variante_in_ordner() {
  local ordner=$1 id=$2 p n
  FOUND_PATH=
  [[ -d $ordner ]] || return 1
  if [[ -f $ordner/$id && ! -L $ordner/$id ]]; then
    FOUND_PATH=$ordner/$id
    return 0
  fi
  for p in "$ordner"/*; do
    [[ -f $p && ! -L $p ]] || continue
    n=${p##*/}
    case "$n" in
      "$id"-*|"$id".*)
        FOUND_PATH=$p
        return 0
        ;;
    esac
  done
  return 1
}

finde_zentral() {
  local id=$1 area=$2 fall_hex=$3 storage=$4 rel root
  FOUND_PATH=
  ROOT_LIST=$STAGE/verwaltung/.roots
  : > "$ROOT_LIST"
  if map_ziel STORAGE ""; then
    printf '%s\n' "$STAGE/$MAP_ZIEL" >> "$ROOT_LIST"
  fi
  if [[ $area == case ]] && map_ziel CASE "$fall_hex"; then
    printf '%s\n' "$STAGE/$MAP_ZIEL" >> "$ROOT_LIST"
  fi
  if map_ziel BASE ""; then
    printf '%s\n' "$STAGE/$MAP_ZIEL" >> "$ROOT_LIST"
  fi
  printf '%s\n' "$STAGE/inhalt/server-data/Dokumentenspeicher" >> "$ROOT_LIST"
  printf '%s\n' "$STAGE/inhalt/server-data/files" >> "$ROOT_LIST"

  while IFS= read -r root; do
    [[ -d $root ]] || continue
    if [[ -n $storage ]] && sicher_relativ "$storage" &&
       [[ -f $root/$storage && ! -L $root/$storage ]]; then
      FOUND_PATH=$root/$storage
      rm -f -- "$ROOT_LIST"
      return 0
    fi
    if id_sicher "$id" && variante_in_ordner "$root" "$id"; then
      rm -f -- "$ROOT_LIST"
      return 0
    fi
  done < "$ROOT_LIST"
  rm -f -- "$ROOT_LIST"
  return 1
}

pruefe_datei() {
  local art=$1 id=$2 soll_groesse=$3 soll_sha=$4 ist_groesse ist_sha
  ERWARTET=$((ERWARTET + 1))
  if [[ -z ${FOUND_PATH:-} ]]; then
    befund "$art '$id': Inhaltsdatei fehlt."
    return
  fi
  ist_groesse=$(wc -c < "$FOUND_PATH" | tr -d ' ')
  if [[ $soll_groesse =~ ^[0-9]+$ && $ist_groesse != "$soll_groesse" ]]; then
    befund "$art '$id': Groesse $ist_groesse statt $soll_groesse Bytes."
    return
  fi
  if [[ -n $soll_sha ]]; then
    ist_sha=$(sha_datei "$FOUND_PATH")
    ist_sha=$(printf '%s' "$ist_sha" | tr 'A-F' 'a-f')
    soll_sha=$(printf '%s' "$soll_sha" | tr 'A-F' 'a-f')
    if [[ $ist_sha != "$soll_sha" ]]; then
      befund "$art '$id': SHA-256 stimmt nicht."
      return
    fi
  fi
  GEPRUEFT=$((GEPRUEFT + 1))
}

# Die beiden portablen Sicherheitsabbilder sind der einzige Rückweg, wenn bei
# einem vollständigen Serververlust auch ENCRYPTION_KEY neu erzeugt werden
# muss. Ein direkter Shell-Lauf darf sie deshalb nicht mehr still auslassen.
# Die Prüfung verwendet ausschließlich die DB-Kopie und die bereits kopierten
# Snapshotdateien. Der geheime Recovery-Key wird nur im Speicher zur
# authentifizierten Probe verwendet und weder protokolliert noch gesichert.
RECOVERY_FINGERPRINT=
RECOVERY_KEY_ID=
RECOVERY_GENERATION_ID=
RECOVERY_SOURCE_REVISION=
REC_FILE_ART_EXPR="''"
REC_VISIBILITY_EXPR="''"
REC_MANAGED_EXPR="0"
REC_DELETED_EXPR="''"
REC_STORAGE_EXPR="''"
if sql_hat_tabelle "$DB_KOPIE" doc_files; then
  sql_hat_spalte "$DB_KOPIE" doc_files artifact_kind && REC_FILE_ART_EXPR="f.artifact_kind"
  sql_hat_spalte "$DB_KOPIE" doc_files visibility && REC_VISIBILITY_EXPR="f.visibility"
  sql_hat_spalte "$DB_KOPIE" doc_files managed && REC_MANAGED_EXPR="f.managed"
  sql_hat_spalte "$DB_KOPIE" doc_files deleted_at && REC_DELETED_EXPR="f.deleted_at"
  sql_hat_spalte "$DB_KOPIE" doc_files storage_relpath && REC_STORAGE_EXPR="f.storage_relpath"
fi
pruefe_recovery_abbild() {
  local art=$1 schema=$2 zeile
  local ID_HEX STATUS_HEX SOURCE_HEX MATERIAL_SHA_HEX GENERATED_HEX
  local AREA_HEX FALL_HEX SIZE FILE_SHA_HEX STORAGE_HEX FILE_ART_HEX
  local VISIBILITY_HEX MANAGED DELETED_HEX
  local ID STATUS SOURCE MATERIAL_SHA GENERATED AREA FILE_SHA STORAGE FILE_ART
  local VISIBILITY DELETED PRUEF_AUSGABE PRUEF_STATUS KEY_ID GENERATION_ID ENVELOPE_SOURCE FP CRYPTO_STATUS
  local FEHLER_VORHER
  local FP_LOWER EXPECTED_FP_LOWER RECOVERY_FP_LOWER FILE_SHA_LOWER MATERIAL_SHA_LOWER
  local SOURCE_LOWER ENVELOPE_SOURCE_LOWER KEY_ID_LOWER GENERATION_ID_LOWER

  if ! zeile=$(sqlite3 -batch -noheader "$DB_KOPIE" "
    SELECT hex(COALESCE(m.file_id,''))||'|'||hex(m.status)||'|'||
           hex(m.source_revision)||'|'||hex(m.sha256)||'|'||hex(m.generated_at)||'|'||
           hex(COALESCE(f.area,''))||'|'||hex(COALESCE(f.case_id,''))||'|'||
           COALESCE(f.size,'')||'|'||hex(COALESCE(f.sha256,''))||'|'||
           hex(COALESCE($REC_STORAGE_EXPR,''))||'|'||
           hex(COALESCE($REC_FILE_ART_EXPR,''))||'|'||
           hex(COALESCE($REC_VISIBILITY_EXPR,''))||'|'||
           COALESCE($REC_MANAGED_EXPR,0)||'|'||hex(COALESCE($REC_DELETED_EXPR,''))
      FROM doc_materializations m
      LEFT JOIN doc_files f ON f.id=m.file_id
     WHERE m.scope_type='office' AND m.scope_id=''
       AND m.artifact_kind='$art';"); then
    befund "SQLite-Pruefabfrage fuer Pflicht-Materialisierung '$art' ist fehlgeschlagen."
    return
  fi
  if [[ -z $zeile || $(printf '%s\n' "$zeile" | wc -l | tr -d ' ') != 1 ]]; then
    if ((RECOVERY_AUSNAHME)); then
      hinweis "AUSNAHME AKTIV: Materialisierung '$art' fehlt; dieser Bootstrap-/Testsnapshot besitzt keinen portablen Sicherheitsrueckweg."
    else
      befund "Pflicht-Materialisierung '$art' fehlt oder ist nicht eindeutig."
    fi
    return
  fi

  IFS='|' read -r ID_HEX STATUS_HEX SOURCE_HEX MATERIAL_SHA_HEX GENERATED_HEX \
    AREA_HEX FALL_HEX SIZE FILE_SHA_HEX STORAGE_HEX FILE_ART_HEX \
    VISIBILITY_HEX MANAGED DELETED_HEX <<< "$zeile"
  hex_nach_variable ID "$ID_HEX"
  hex_nach_variable STATUS "$STATUS_HEX"
  hex_nach_variable SOURCE "$SOURCE_HEX"
  hex_nach_variable MATERIAL_SHA "$MATERIAL_SHA_HEX"
  hex_nach_variable GENERATED "$GENERATED_HEX"
  hex_nach_variable AREA "$AREA_HEX"
  hex_nach_variable FILE_SHA "$FILE_SHA_HEX"
  hex_nach_variable STORAGE "$STORAGE_HEX"
  hex_nach_variable FILE_ART "$FILE_ART_HEX"
  hex_nach_variable VISIBILITY "$VISIBILITY_HEX"
  hex_nach_variable DELETED "$DELETED_HEX"

  [[ $STATUS == ok ]] || befund "Materialisierung '$art' hat Status '$STATUS' statt 'ok'."
  [[ -n $ID && -n $SOURCE && -n $MATERIAL_SHA && -n $GENERATED ]] ||
    befund "Materialisierung '$art' hat keine vollstaendigen Erfolgsmetadaten."
  [[ $AREA == management && $FILE_ART == "$art" && $VISIBILITY == admin && $MANAGED == 1 ]] ||
    befund "Materialisierung '$art' ist nicht als verwaltetes Admin-Artefakt ausgewiesen."
  [[ -z $DELETED ]] || befund "Materialisierung '$art' verweist auf eine geloeschte Datei."
  FILE_SHA_LOWER=$(printf '%s' "$FILE_SHA" | tr 'A-F' 'a-f')
  MATERIAL_SHA_LOWER=$(printf '%s' "$MATERIAL_SHA" | tr 'A-F' 'a-f')
  [[ -n $FILE_SHA && $FILE_SHA_LOWER == "$MATERIAL_SHA_LOWER" ]] ||
    befund "Materialisierung '$art' und doc_files haben unterschiedliche SHA-256-Werte."

  if finde_zentral "$ID" "$AREA" "$FALL_HEX" "$STORAGE"; then :; else FOUND_PATH=; fi
  FEHLER_VORHER=$FEHLER
  pruefe_datei "Pflicht-Materialisierung $art" "$ID" "$SIZE" "$FILE_SHA"
  ((FEHLER == FEHLER_VORHER)) || return

  if ! PRUEF_AUSGABE=$(BACKUP_RECOVERY_KEY="$AKTIVER_RECOVERY_KEY" \
    node "$SCRIPT_DIR/verify-recovery-envelope.js" "$FOUND_PATH" "$schema" 2>&1); then
    befund "Materialisierung '$art' ist kein gueltiger portabler Verschluesselungsumschlag: $PRUEF_AUSGABE"
    return
  fi
  IFS='|' read -r PRUEF_STATUS KEY_ID GENERATION_ID ENVELOPE_SOURCE FP CRYPTO_STATUS <<< "$PRUEF_AUSGABE"
  if [[ $PRUEF_STATUS != OK ||
        ! $KEY_ID =~ ^(drk_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|legacy_[0-9a-f]{32})$ ||
        ! $GENERATION_ID =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ||
        ! $ENVELOPE_SOURCE =~ ^[0-9a-f]{64}$ || ! $FP =~ ^[0-9a-f]{24}$ ||
        ( $CRYPTO_STATUS != verified && $CRYPTO_STATUS != unverified ) ]]; then
    befund "Materialisierung '$art' lieferte ein ungueltiges Pruefergebnis."
    return
  fi
  if [[ $CRYPTO_STATUS == verified ]]; then
    hinweis "Materialisierung '$art' wurde authentifiziert entschluesselt; inneres Schema, Payload-Typ und Version sind gueltig."
  else
    if ((RECOVERY_AUSNAHME)); then
      hinweis "AUSNAHME AKTIV: Materialisierung '$art' ist strukturell gueltig, aber kryptografisch ungeprueft."
    else
      befund "Materialisierung '$art' wurde nicht authentifiziert entschluesselt."
    fi
  fi
  SOURCE_LOWER=$(printf '%s' "$SOURCE" | tr 'A-F' 'a-f')
  ENVELOPE_SOURCE_LOWER=$(printf '%s' "$ENVELOPE_SOURCE" | tr 'A-F' 'a-f')
  if [[ ! $SOURCE_LOWER =~ ^[0-9a-f]{64}$ || $SOURCE_LOWER != "$ENVELOPE_SOURCE_LOWER" ]]; then
    befund "Materialisierung '$art' gehoert nicht zur in doc_materializations ausgewiesenen Quellrevision."
  fi
  KEY_ID_LOWER=$(printf '%s' "$KEY_ID" | tr 'A-F' 'a-f')
  GENERATION_ID_LOWER=$(printf '%s' "$GENERATION_ID" | tr 'A-F' 'a-f')
  if [[ -n $AKTIVER_RECOVERY_KEY_ID &&
        $(printf '%s' "$AKTIVER_RECOVERY_KEY_ID" | tr 'A-F' 'a-f') != "$KEY_ID_LOWER" ]]; then
    befund "Materialisierung '$art' verwendet nicht die Generation des aktiven verwalteten Recovery-Keys."
  fi
  if [[ -z $RECOVERY_KEY_ID ]]; then
    RECOVERY_KEY_ID=$KEY_ID_LOWER
    RECOVERY_GENERATION_ID=$GENERATION_ID_LOWER
    RECOVERY_SOURCE_REVISION=$ENVELOPE_SOURCE_LOWER
  elif [[ $RECOVERY_KEY_ID != "$KEY_ID_LOWER" ||
          $RECOVERY_GENERATION_ID != "$GENERATION_ID_LOWER" ||
          $RECOVERY_SOURCE_REVISION != "$ENVELOPE_SOURCE_LOWER" ]]; then
    befund "Sicherheit.json.enc und Zugangsdaten.json.enc stammen nicht aus derselben Recovery-Generation."
  fi
  FP_LOWER=$(printf '%s' "$FP" | tr 'A-F' 'a-f')
  EXPECTED_FP_LOWER=$(printf '%s' "$ERWARTETER_RECOVERY_FP" | tr 'A-F' 'a-f')
  if [[ -n $ERWARTETER_RECOVERY_FP && $FP_LOWER != "$EXPECTED_FP_LOWER" ]]; then
    befund "Materialisierung '$art' passt nicht zum aktiven Recovery-Key-Fingerabdruck."
  fi
  if [[ -z $RECOVERY_FINGERPRINT ]]; then
    RECOVERY_FINGERPRINT=$FP
  else
    RECOVERY_FP_LOWER=$(printf '%s' "$RECOVERY_FINGERPRINT" | tr 'A-F' 'a-f')
    if [[ $RECOVERY_FP_LOWER != "$FP_LOWER" ]]; then
      befund "Sicherheit.json.enc und Zugangsdaten.json.enc verwenden unterschiedliche Recovery-Key-Fingerabdruecke."
    fi
  fi
}

if sql_hat_tabelle "$DB_KOPIE" doc_materializations && sql_hat_tabelle "$DB_KOPIE" doc_files; then
  pruefe_recovery_abbild security-encrypted security/3
  pruefe_recovery_abbild credentials-encrypted credentials/3
else
  if ((RECOVERY_AUSNAHME)); then
    hinweis "AUSNAHME AKTIV: doc_materializations/doc_files fehlen; kein portabler Sicherheitsrueckweg."
  else
    befund "Pflichttabellen fuer portable Sicherheitsabbilder fehlen."
  fi
fi
if [[ -n $RECOVERY_SOURCE_REVISION ]]; then
  RECOVERY_REVISION_HELPER=$SCRIPT_DIR/verify-portable-recovery-revision.js
  if [[ ! -f $RECOVERY_REVISION_HELPER || -L $RECOVERY_REVISION_HELPER ]]; then
    befund "Pruefwerkzeug fuer die aktuelle portable Recovery-Quellrevision fehlt oder ist unsicher."
  elif RECOVERY_REVISION_AUSGABE=$(node "$RECOVERY_REVISION_HELPER" \
      "$DB_KOPIE" "$RECOVERY_SOURCE_REVISION" 2>&1); then
    if [[ $RECOVERY_REVISION_AUSGABE == \
      "OK|PORTABLE_RECOVERY_SOURCE_REVISION|$RECOVERY_SOURCE_REVISION" ]]; then
      hinweis "Beide Recovery-Abbilder entsprechen der aktuellen portablen Quellrevision der SQLite-Sicherung."
    else
      befund "Pruefwerkzeug fuer die aktuelle portable Recovery-Quellrevision lieferte ein ungueltiges Ergebnis."
    fi
  else
    befund "Recovery-Abbilder sind gegenueber der SQLite-Sicherung veraltet oder nicht pruefbar ($RECOVERY_REVISION_AUSGABE)."
  fi
fi
AKTIVER_RECOVERY_KEY=
AKTIVER_RECOVERY_KEY_ID=
unset AKTIVER_RECOVERY_KEY

# Zentraler Dokumentenspeicher, inklusive Papierkorb und Versionen.
if sql_hat_tabelle "$DB_KOPIE" doc_files; then
  STORAGE_EXPR="''"
  sql_hat_spalte "$DB_KOPIE" doc_files storage_relpath && STORAGE_EXPR="storage_relpath"
  DOC_FILES_ZEILEN=$STAGE/verwaltung/.doc-files-zeilen
  sqlite_zeilen_datei "doc_files" "
    SELECT hex(id)||'|'||hex(area)||'|'||hex(case_id)||'|'||size||'|'||
           hex(sha256)||'|'||hex($STORAGE_EXPR)
      FROM doc_files ORDER BY id;" "$DOC_FILES_ZEILEN" || :
  while IFS='|' read -r ID_HEX AREA_HEX FALL_HEX SIZE SHA_HEX STORAGE_HEX; do
    hex_nach_variable ID "$ID_HEX"
    hex_nach_variable AREA "$AREA_HEX"
    hex_nach_variable SHA "$SHA_HEX"
    hex_nach_variable STORAGE "$STORAGE_HEX"
    if finde_zentral "$ID" "$AREA" "$FALL_HEX" "$STORAGE"; then :; else FOUND_PATH=; fi
    pruefe_datei "doc_files" "$ID" "$SIZE" "$SHA"
  done < "$DOC_FILES_ZEILEN"
  rm -f -- "$DOC_FILES_ZEILEN"
fi

if sql_hat_tabelle "$DB_KOPIE" doc_versions; then
  V_STORAGE_EXPR="''"
  sql_hat_spalte "$DB_KOPIE" doc_versions storage_relpath && V_STORAGE_EXPR="v.storage_relpath"
  DOC_VERSIONS_ZEILEN=$STAGE/verwaltung/.doc-versions-zeilen
  sqlite_zeilen_datei "doc_versions" "
    SELECT hex(v.id)||'|'||hex(COALESCE(f.area,'office'))||'|'||
           hex(COALESCE(f.case_id,''))||'|'||v.size||'|'||hex(v.sha256)||'|'||
           hex($V_STORAGE_EXPR)
      FROM doc_versions v LEFT JOIN doc_files f ON f.id=v.file_id ORDER BY v.id;" \
    "$DOC_VERSIONS_ZEILEN" || :
  while IFS='|' read -r ID_HEX AREA_HEX FALL_HEX SIZE SHA_HEX STORAGE_HEX; do
    hex_nach_variable ID "$ID_HEX"
    hex_nach_variable AREA "$AREA_HEX"
    hex_nach_variable SHA "$SHA_HEX"
    hex_nach_variable STORAGE "$STORAGE_HEX"
    if finde_zentral "$ID" "$AREA" "$FALL_HEX" "$STORAGE"; then :; else FOUND_PATH=; fi
    pruefe_datei "doc_versions" "$ID" "$SIZE" "$SHA"
  done < "$DOC_VERSIONS_ZEILEN"
  rm -f -- "$DOC_VERSIONS_ZEILEN"
fi

finde_moduldatei() {
  local basis=$1 id=$2
  FOUND_PATH=
  id_sicher "$id" || return 1
  variante_in_ordner "$basis" "$id"
}

# Nach dem Umbau besitzen Fachmodule keine zweite Inhaltskopie mehr. Der primaere
# Rueckweg ist deshalb doc_links -> doc_files -> storage_relpath. Der Legacy-Pfad
# bleibt darunter als reiner Fallback fuer noch nicht umgehaengten Bestand.
finde_modul_link() {
  local modul=$1 owner_hex=$2 slot_hex=$3 geteilt=${4:-nein}
  local fall_erwartet_hex=${5:-}
  local storage_expr="''" zeile id_hex area_hex fall_hex storage_hex sha_hex
  local LINK_FILE_ID LINK_AREA LINK_STORAGE LINK_SHA
  FOUND_PATH=
  [[ $modul =~ ^[a-z][a-z0-9-]*$ ]] || return 1
  [[ $owner_hex =~ ^([0-9A-Fa-f][0-9A-Fa-f])*$ ]] || return 1
  [[ $slot_hex =~ ^([0-9A-Fa-f][0-9A-Fa-f])*$ ]] || return 1
  [[ $fall_erwartet_hex =~ ^([0-9A-Fa-f][0-9A-Fa-f])*$ ]] || return 1
  sql_hat_tabelle "$DB_KOPIE" doc_links || return 1
  sql_hat_tabelle "$DB_KOPIE" doc_files || return 1
  sql_hat_spalte "$DB_KOPIE" doc_files storage_relpath && storage_expr='f.storage_relpath'
  if [[ $geteilt == ja ]]; then
    if ! zeile=$(sqlite3 -batch -noheader "$DB_KOPIE" "
      SELECT hex(f.id)||'|'||hex(f.area)||'|'||hex(f.case_id)||'|'||
             hex($storage_expr)||'|'||hex(f.sha256)
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='$modul' AND lower(hex(l.slot))=lower('$slot_hex')
         AND ('$fall_erwartet_hex'='' OR
              lower(hex(f.case_id))=lower('$fall_erwartet_hex'))
         AND COALESCE(f.deleted_at,'')=''
       ORDER BY CASE WHEN lower(hex(l.owner_id))=lower('$owner_hex') THEN 0 ELSE 1 END,
                l.created_at,l.owner_id
       LIMIT 1;"); then
      befund "SQLite-Pruefabfrage fuer Modulverknuepfung '$modul' ist fehlgeschlagen."
      return 1
    fi
  else
    if ! zeile=$(sqlite3 -batch -noheader "$DB_KOPIE" "
      SELECT hex(f.id)||'|'||hex(f.area)||'|'||hex(f.case_id)||'|'||
             hex($storage_expr)||'|'||hex(f.sha256)
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='$modul' AND lower(hex(l.owner_id))=lower('$owner_hex')
         AND lower(hex(l.slot))=lower('$slot_hex') AND COALESCE(f.deleted_at,'')=''
         AND ('$fall_erwartet_hex'='' OR
              lower(hex(f.case_id))=lower('$fall_erwartet_hex'))
       ORDER BY l.created_at LIMIT 1;"); then
      befund "SQLite-Pruefabfrage fuer Modulverknuepfung '$modul' ist fehlgeschlagen."
      return 1
    fi
  fi
  [[ -n $zeile ]] || return 1
  IFS='|' read -r id_hex area_hex fall_hex storage_hex sha_hex <<< "$zeile"
  hex_nach_variable LINK_FILE_ID "$id_hex"
  hex_nach_variable LINK_AREA "$area_hex"
  hex_nach_variable LINK_STORAGE "$storage_hex"
  hex_nach_variable LINK_SHA "$sha_hex"
  finde_zentral "$LINK_FILE_ID" "$LINK_AREA" "$fall_hex" "$LINK_STORAGE"
}

pruefe_einfache_tabelle() {
  local tabelle=$1 sql=$2 wurzel=$3 unterordner=$4 modul=$5 owner_art=$6 slot_art=$7
  local link_owner_hex link_slot_hex zeilen
  sql_hat_tabelle "$DB_KOPIE" "$tabelle" || return 0
  zeilen=$STAGE/verwaltung/.modul-"$tabelle"-zeilen
  sqlite_zeilen_datei "$tabelle" "$sql" "$zeilen" || :
  while IFS='|' read -r ID_HEX OWNER_HEX SIZE; do
    hex_nach_variable ID "$ID_HEX"
    hex_nach_variable OWNER "$OWNER_HEX"
    [[ $owner_art == id ]] && link_owner_hex=$ID_HEX || link_owner_hex=$OWNER_HEX
    case "$slot_art" in
      id) link_slot_hex=$ID_HEX ;;
      owner) link_slot_hex=$OWNER_HEX ;;
      *) link_slot_hex= ;;
    esac
    if finde_modul_link "$modul" "$link_owner_hex" "$link_slot_hex"; then
      :
    else
      BASIS=$STAGE/inhalt/server-data/$wurzel
      [[ $unterordner == ja ]] && BASIS=$BASIS/$OWNER
      if finde_moduldatei "$BASIS" "$ID"; then :; else FOUND_PATH=; fi
    fi
    pruefe_datei "$tabelle" "$ID" "$SIZE" ""
  done < "$zeilen"
  rm -f -- "$zeilen"
}

pruefe_einfache_tabelle case_documents \
  "SELECT hex(id)||'|'||hex(case_id)||'|'||size FROM case_documents ORDER BY id;" \
  case-documents ja case-document id leer
pruefe_einfache_tabelle calendar_event_attachments \
  "SELECT hex(id)||'|'||hex(event_id)||'|'||size FROM calendar_event_attachments ORDER BY id;" \
  calendar-event-attachments ja calendar-attachment owner id
pruefe_einfache_tabelle todo_attachments \
  "SELECT hex(id)||'|'||hex(todo_id)||'|'||size FROM todo_attachments ORDER BY id;" \
  todo-attachments ja todo-attachment owner id
pruefe_einfache_tabelle inbox_documents \
  "SELECT hex(id)||'||'||size FROM inbox_documents ORDER BY id;" \
  inbox-documents nein inbox id leer
pruefe_einfache_tabelle finance_receipts \
  "SELECT hex(id)||'||'||size FROM finance_receipts ORDER BY id;" \
  finance-receipts nein finance-receipt id leer
pruefe_einfache_tabelle finance_statements \
  "SELECT hex(id)||'||'||size FROM finance_statements ORDER BY id;" \
  finance-statements nein finance-statement id leer

if sql_hat_tabelle "$DB_KOPIE" office_profile; then
  OFFICE_PROFILE_ZEILEN=$STAGE/verwaltung/.office-profile-zeilen
  sqlite_zeilen_datei "office_profile" \
    "SELECT hex(logo_filename) FROM office_profile WHERE id=1 AND logo_filename!='';" \
    "$OFFICE_PROFILE_ZEILEN" || :
  while IFS='|' read -r NAME_HEX; do
    hex_nach_variable NAME "$NAME_HEX"
    DEFAULT_HEX=$(hex default)
    OFFICE_PROFILE_HEX=$(hex office-profile)
    LOGO_HEX=$(hex logo)
    if finde_modul_link office-logo "$DEFAULT_HEX" ""; then
      :
    elif finde_modul_link office-logo "$OFFICE_PROFILE_HEX" "$LOGO_HEX"; then
      :
    elif [[ ${NAME##*/} == "$NAME" && -f $STAGE/inhalt/server-data/office-logo/$NAME &&
            ! -L $STAGE/inhalt/server-data/office-logo/$NAME ]]; then
      FOUND_PATH=$STAGE/inhalt/server-data/office-logo/$NAME
    else
      FOUND_PATH=
    fi
    pruefe_datei "office_profile" "$NAME" "" ""
  done < "$OFFICE_PROFILE_ZEILEN"
  rm -f -- "$OFFICE_PROFILE_ZEILEN"
fi

if sql_hat_tabelle "$DB_KOPIE" case_doku_entries; then
  DOKU_ZEILEN=$STAGE/verwaltung/.falldokumentation-zeilen
  sqlite_zeilen_datei "case_doku_entries.photos" "
    SELECT hex(d.case_id)||'|'||hex(d.id)||'|'||
           hex(CAST(json_extract(p.value,'\$.id') AS TEXT))||'|'||
           COALESCE(CASE WHEN typeof(json_extract(p.value,'\$.size')) IN ('integer','real')
                         THEN CAST(json_extract(p.value,'\$.size') AS INTEGER) END,'')
      FROM case_doku_entries d,
           json_each(CASE WHEN json_valid(d.data_json) THEN d.data_json
                          ELSE '{\"photos\":[]}' END, '\$.photos') p
     WHERE typeof(json_extract(p.value,'\$.id'))='text'
       AND json_extract(p.value,'\$.id')!=''
     ORDER BY d.case_id,d.id;" "$DOKU_ZEILEN" || :
  while IFS='|' read -r FALL_HEX EINTRAG_HEX FOTO_HEX SIZE; do
    hex_nach_variable FALL "$FALL_HEX"
    hex_nach_variable EINTRAG "$EINTRAG_HEX"
    hex_nach_variable FOTO "$FOTO_HEX"
    FOUND_PATH=
    if finde_modul_link doku-photo "$EINTRAG_HEX" "$FOTO_HEX" ja "$FALL_HEX"; then
      :
    elif id_sicher "$FALL" && id_sicher "$EINTRAG" && id_sicher "$FOTO"; then
      DOKU_BASIS=$STAGE/inhalt/server-data/case-doku-photos/$FALL
      if [[ -f $DOKU_BASIS/_dateien/$FOTO && ! -L $DOKU_BASIS/_dateien/$FOTO ]]; then
        FOUND_PATH=$DOKU_BASIS/_dateien/$FOTO
      elif [[ -f $DOKU_BASIS/$EINTRAG/$FOTO && ! -L $DOKU_BASIS/$EINTRAG/$FOTO ]]; then
        FOUND_PATH=$DOKU_BASIS/$EINTRAG/$FOTO
      elif [[ -d $DOKU_BASIS ]]; then
        for D in "$DOKU_BASIS"/*; do
          [[ -d $D && -f $D/$FOTO && ! -L $D/$FOTO ]] || continue
          FOUND_PATH=$D/$FOTO
          break
        done
      fi
    fi
    pruefe_datei "Falldokumentations-Anlage" "$FOTO" "$SIZE" ""
  done < "$DOKU_ZEILEN"
  rm -f -- "$DOKU_ZEILEN"
fi

# Ein Symlink ist kein in sich geschlossener Dateiinhalt. Er bleibt im Tar-Abbild
# erhalten, macht die Sicherung aber sichtbar unvollstaendig.
while IFS= read -r -d '' LINK; do
  REL=${LINK#"$STAGE/"}
  befund "Symbolischer Link im Snapshot (Zielinhalt nicht garantiert): $REL"
done < <(find "$STAGE/inhalt" -type l -print0)
while IFS= read -r -d '' SPEZIAL; do
  REL=${SPEZIAL#"$STAGE/"}
  befund "Spezialdatei im Snapshot ist kein eigenstaendiger Dateiinhalt: $REL"
done < <(find "$STAGE/inhalt" ! -type f ! -type d ! -type l -print0)

# Für einen Server-Neuaufbau werden neben den Fachdaten die exakt ausgelieferte
# Single-File-App, Paket-/Containerdefinitionen, Vorlagen und tatsächlich
# hochgeladene Browser-Erweiterungspakete mitgeführt. Geheimnisdateien (.env,
# runtime-secrets, Recovery-/restic-Key) sind bewusst nicht Teil dieses Baums.
kopiere_laufzeitdatei_konsistent() {
  local quelle=$1 ziel=$2 bezeichnung=$3 vor nach kopie
  [[ -f $quelle && ! -L $quelle ]] || {
    printf '%s: Laufzeitdatei ist nicht mehr regulaer: %s\n' "$PROGRAMM" "$quelle" >&2
    return 2
  }
  vor=$(sha_datei "$quelle") || return 2
  cp -p -- "$quelle" "$ziel" || return 2
  [[ -f $quelle && ! -L $quelle && -f $ziel && ! -L $ziel ]] || return 2
  nach=$(sha_datei "$quelle") || return 2
  kopie=$(sha_datei "$ziel") || return 2
  if [[ $vor != "$nach" || $vor != "$kopie" ]]; then
    printf '%s: Laufzeitdatei hat sich waehrend der Sicherung geaendert: %s\n' \
      "$PROGRAMM" "$bezeichnung" >&2
    return 2
  fi
}

kopiere_laufzeitbaum_konsistent() {
  local quelle=$1 ziel=$2 bezeichnung=$3 vor nach
  vor=$(baum_signatur "$quelle") || return 2
  kopiere_baum "$quelle" "$ziel" || return 2
  nach=$(baum_signatur "$quelle") || return 2
  if [[ $vor != "$nach" ]]; then
    printf '%s: Laufzeitbaum hat sich waehrend der Sicherung geaendert: %s\n' \
      "$PROGRAMM" "$bezeichnung" >&2
    return 2
  fi
}

dateiliste_signatur() {
  node - "$@" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.argv[2]);
const rows = process.argv.slice(3).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
const hash = crypto.createHash('sha256');
try {
  for (const rel of rows) {
    const abs = path.resolve(root, rel);
    const within = path.relative(root, abs);
    if (!within || within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
      throw new Error(`unsicherer relativer Pfad: ${rel}`);
    }
    const fd = fs.openSync(abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const before = fs.fstatSync(fd, { bigint: true });
      if (!before.isFile()) throw new Error(`keine regulaere Datei: ${rel}`);
      const content = fs.readFileSync(fd);
      const after = fs.fstatSync(fd, { bigint: true });
      for (const field of ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs']) {
        if (before[field] !== after[field]) throw new Error(`Datei waehrend des Lesens geaendert: ${rel}`);
      }
      hash.update(rel + '\0');
      hash.update(String(before.mode) + '\0' + String(before.mtimeNs) + '\0');
      hash.update(content);
      hash.update('\n');
    } finally {
      fs.closeSync(fd);
    }
  }
  process.stdout.write(hash.digest('hex'));
} catch (error) {
  console.error(`Dateilistensignatur fehlgeschlagen: ${error.message}`);
  process.exit(2);
}
NODE
}

BETRIEB=$STAGE/betrieb
mkdir -p -- "$BETRIEB/anwendung" "$BETRIEB/konfiguration" \
  "$BETRIEB/server-ressourcen" "$BETRIEB/browser-erweiterungen"
for KONFIG_NAME in package.json package-lock.json Dockerfile docker-compose.yml .dockerignore .env.example; do
  if [[ -f $SERVER_DIR/$KONFIG_NAME && ! -L $SERVER_DIR/$KONFIG_NAME ]]; then
    kopiere_laufzeitdatei_konsistent "$SERVER_DIR/$KONFIG_NAME" \
      "$BETRIEB/konfiguration/$KONFIG_NAME" "Konfiguration/$KONFIG_NAME" || exit 2
  else
    befund "Pflicht-Betriebskonfiguration '$KONFIG_NAME' fehlt; ein sicherer Online-Neuaufbau ist nicht belegt."
  fi
done
if [[ -d $TEMPLATES_DIR && ! -L $TEMPLATES_DIR ]]; then
  mkdir -p -- "$BETRIEB/server-ressourcen/templates"
  kopiere_laufzeitbaum_konsistent "$TEMPLATES_DIR" \
    "$BETRIEB/server-ressourcen/templates" "assets/templates" || exit 2
else
  befund "Pflicht-Laufzeitbaum 'assets/templates' fehlt; ein vollständiger Online-Restore ist nicht möglich."
fi
if [[ -d $EXTENSION_ARTIFACTS_DIR && ! -L $EXTENSION_ARTIFACTS_DIR ]]; then
  mkdir -p -- "$BETRIEB/browser-erweiterungen"
  kopiere_laufzeitbaum_konsistent "$EXTENSION_ARTIFACTS_DIR" \
    "$BETRIEB/browser-erweiterungen" "runtime/extension-artifacts" || exit 2
else
  hinweis "Keine hochgeladenen Browser-Erweiterungspakete vorhanden."
fi

# Vorlagen-Quellmaterial (Nutzerauftrag 25.08.2026): Die Original-Amtsvordrucke der
# Vorlagenrunde 08/2026 und die PDF-Quellbestaende der Overlay-Werkzeugkette (Golden-,
# AcroForm- und Flach-Staende, an denen die Koordinatenkarten kalibriert wurden) liegen
# NUR im Werkzeugbaum. Die Quellcode-Positivliste unten nimmt bewusst keine Binaerdateien
# mit, und im Laufzeit-Datenbaum haben Kurationsquellen nichts zu suchen - ohne diesen
# Abschnitt waeren sie bei einem Rechnerverlust unwiederbringlich, und die in der App-Datei
# eingebetteten Ableitungen liessen sich nie wieder nachkalibrieren. Der render/-Unterordner
# (~80 MB Sichtpruefungs-PNG) ist aus den PDFs reproduzierbar und bleibt draussen.
# Der Restore laesst diese Pfade bewusst liegen (Fallback '*) continue' der Betriebs-
# artefakte) - sie gehoeren in den Werkzeugbaum, nicht in eine Laufzeit-Stage, und sind
# aus dem Snapshot von Hand zurueckzuholen, wenn die Kuration sie braucht.
QUELLMATERIAL_BASIS=$BETRIEB/server-ressourcen/vorlagen-quellmaterial
QUELLE_KURATIERUNG=$SERVER_DIR/tools/v159-kuratierung/vorlagen-2026-08
if [[ -d $QUELLE_KURATIERUNG && ! -L $QUELLE_KURATIERUNG ]]; then
  mkdir -p -- "$QUELLMATERIAL_BASIS/v159-kuratierung"
  kopiere_laufzeitbaum_konsistent "$QUELLE_KURATIERUNG" \
    "$QUELLMATERIAL_BASIS/v159-kuratierung/vorlagen-2026-08" \
    "tools/v159-kuratierung/vorlagen-2026-08" || exit 2
else
  hinweis "Vorlagen-Quellmaterial 'v159-kuratierung/vorlagen-2026-08' nicht vorhanden."
fi
QUELLE_OVERLAY=$SERVER_DIR/tools/pdf-overlay/vorlagen
if [[ -d $QUELLE_OVERLAY && ! -L $QUELLE_OVERLAY ]]; then
  mkdir -p -- "$QUELLMATERIAL_BASIS/pdf-overlay"
  # Eigene Fassung von kopiere_laufzeitbaum_konsistent, weil render/ ausgenommen wird -
  # Signatur und Kopie muessen denselben Ausschnitt sehen, sonst schluege die
  # Konsistenzpruefung bei jedem Lauf an.
  QM_SIGNATUR_VOR=$(baum_signatur "$QUELLE_OVERLAY" render) || exit 2
  kopiere_baum "$QUELLE_OVERLAY" "$QUELLMATERIAL_BASIS/pdf-overlay/vorlagen" \
    --exclude='./render' || exit 2
  QM_SIGNATUR_NACH=$(baum_signatur "$QUELLE_OVERLAY" render) || exit 2
  if [[ $QM_SIGNATUR_VOR != "$QM_SIGNATUR_NACH" ]]; then
    printf '%s: Laufzeitbaum hat sich waehrend der Sicherung geaendert: %s\n' \
      "$PROGRAMM" "tools/pdf-overlay/vorlagen" >&2
    exit 2
  fi
else
  hinweis "Vorlagen-Quellmaterial 'pdf-overlay/vorlagen' nicht vorhanden."
fi

# Die laufende Serverimplementierung ist für einen Neuaufbau ebenso wesentlich
# wie Datenbank und package-lock.json. Gesichert wird ausschließlich diese
# statische Positivliste; dadurch können .env, Laufzeitgeheimnisse, Datenbanken,
# Logs, node_modules, data/ und _backups/ auch bei späteren Ergänzungen des
# Serverbaums nicht versehentlich in das Quellarchiv geraten.
SERVER_QUELLARCHIV=$BETRIEB/server-quellcode.tar.gz
SERVER_QUELLDATEIEN=(index.js)
for QUELLBAUM in src tools docs assets/ocr; do
  [[ -d $SERVER_DIR/$QUELLBAUM && ! -L $SERVER_DIR/$QUELLBAUM ]] || continue
  while IFS= read -r -d '' QUELLE; do
    QUELL_REL=${QUELLE#"$SERVER_DIR/"}
    [[ $QUELL_REL != "$QUELLE" ]] || continue
    case "$QUELL_REL" in
      # In case-Mustern matcht '*' auch '/' - ohne diesen Wachposten zoege z. B.
      # tools/*/*.js die kompletten node_modules unter tools/pdf-overlay/ mit ins
      # Quellarchiv (360 Dateien, gemessen 25.08.2026), entgegen der ausdruecklichen
      # Zusage im Kommentar ueber dieser Liste. package-lock.json macht sie ersetzbar.
      */node_modules/*) ;;
      src/*.js|src/*.cjs|src/*/*.js|src/*/*.cjs|src/*/*/*.js|src/*/*/*.cjs|\
      tools/*.js|tools/*.cjs|tools/*.mjs|tools/*.sh|tools/*/*.js|tools/*/*.cjs|\
      tools/*/*.mjs|tools/*/*.sh|tools/*/*.example|docs/*.txt|docs/*.md|\
      tools/*.json|tools/*/*.json|\
      assets/ocr/*.js|assets/ocr/*/*.js|assets/ocr/*/*.traineddata.gz)
        SERVER_QUELLDATEIEN+=("$QUELL_REL")
        ;;
    esac
  done < <(find "$SERVER_DIR/$QUELLBAUM" -type f ! -name '.DS_Store' -print0)
done
for PFLICHT_QUELLE in index.js src/database/index.js; do
  PFLICHT_GEFUNDEN=0
  for QUELL_REL in "${SERVER_QUELLDATEIEN[@]}"; do
    if [[ $QUELL_REL == "$PFLICHT_QUELLE" ]]; then
      PFLICHT_GEFUNDEN=1
      break
    fi
  done
  ((PFLICHT_GEFUNDEN)) ||
    befund "Pflichtquelle '$PFLICHT_QUELLE' fehlt; ein exakter Server-Neuaufbau ist nicht belegt."
done
if ((${#SERVER_QUELLDATEIEN[@]})); then
  SERVER_QUELLSIGNATUR_VORHER=$(dateiliste_signatur "$SERVER_DIR" \
    "${SERVER_QUELLDATEIEN[@]}") || exit 2
  tar -C "$SERVER_DIR" -czf "$SERVER_QUELLARCHIV" "${SERVER_QUELLDATEIEN[@]}" || exit 2
  SERVER_QUELLSIGNATUR_NACHHER=$(dateiliste_signatur "$SERVER_DIR" \
    "${SERVER_QUELLDATEIEN[@]}") || exit 2
  if [[ $SERVER_QUELLSIGNATUR_VORHER != "$SERVER_QUELLSIGNATUR_NACHHER" ]]; then
    printf '%s: Server-Quellcode hat sich waehrend der Sicherung geaendert.\n' \
      "$PROGRAMM" >&2
    exit 2
  fi
else
  befund "Keine Datei der festen Server-Quellcode-Positivliste gefunden."
fi

if [[ -z $APP_DATEI ]]; then
  APP_TREFFER=()
  for P in "$SERVER_DIR/../outputs"/Betreuungsbuero_Dokumentenassistent_v*.html; do
    [[ -f $P && ! -L $P ]] && APP_TREFFER+=("$P")
  done
  if ((${#APP_TREFFER[@]} == 1)); then
    APP_DATEI=${APP_TREFFER[0]}
  elif ((${#APP_TREFFER[@]} > 1)); then
    befund "Mehrere App-Dateien gefunden; --app-file muss die ausgelieferte Fassung eindeutig festlegen."
  else
    befund "Keine ausgelieferte App-Datei gefunden; die gesicherte Programmversion waere nicht wiederherstellbar."
  fi
fi
if [[ -n $APP_DATEI ]]; then
  APP_BASIS=${APP_DATEI##*/}
  kopiere_laufzeitdatei_konsistent "$APP_DATEI" "$BETRIEB/anwendung/$APP_BASIS" \
    "Single-File-App/$APP_BASIS" || exit 2
fi

INVENTAR=$BETRIEB/BETRIEBSINVENTAR.txt
BUILD_ID_WERT=${BETREUUNGSBUERO_BUILD_ID:-}
if [[ -n $BUILD_ID_WERT &&
      ( ${#BUILD_ID_WERT} -gt 128 || ! $BUILD_ID_WERT =~ ^[[:alnum:].:_+-]+$ ) ]]; then
  hinweis "BETREUUNGSBUERO_BUILD_ID wurde wegen unzulaessigem Format nicht in das Betriebsinventar uebernommen."
  BUILD_ID_WERT=
fi
GIT_COMMIT=
if command -v git >/dev/null 2>&1; then
  GIT_COMMIT=$(git -C "$SERVER_DIR" rev-parse --verify HEAD 2>/dev/null || true)
  [[ $GIT_COMMIT =~ ^[0-9a-fA-F]{40,64}$ ]] || GIT_COMMIT=
fi
inventar_umgebungswert() {
  local name=$1 wert=${!1-}
  if [[ -z $wert ]]; then
    printf 'nicht gesetzt'
    return
  fi
  if ((${#wert} > 2048)) || [[ $wert == *$'\n'* || $wert == *$'\r'* ||
                               $wert == *$'\t'* ]]; then
    printf 'gesetzt, aber wegen unzulässiger Länge/Steuerzeichen nicht protokolliert'
    return
  fi
  printf '%s' "$wert"
}
inventar_urlwert() {
  local name=$1 wert=${!1-}
  if [[ -z $wert ]]; then
    printf 'nicht gesetzt'
    return
  fi
  if [[ $wert == *$'\n'* || $wert == *$'\r'* || $wert == *$'\t'* ||
        $wert == *'?'* || $wert == *'#'* ||
        $wert =~ ^[[:alpha:]][[:alnum:]+.-]*://[^/]*@ ]]; then
    printf 'gesetzt, aber wegen möglicher Zugangsdaten nicht im Klartext protokolliert'
    return
  fi
  inventar_umgebungswert "$name"
}
{
  printf 'Betreuungsbuero - Betriebsinventar\n'
  printf 'Erzeugt (lokal): %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
  if [[ -f $SERVER_DIR/package.json ]]; then
    PACKAGE_HEX=$(hex "$SERVER_DIR/package.json")
    PACKAGE_INFO=$(sqlite3 -batch -noheader "$DB_KOPIE" "
      SELECT COALESCE(json_extract(CAST(readfile(CAST(X'$PACKAGE_HEX' AS TEXT)) AS TEXT),'\$.name'),'')||
             ' '||
             COALESCE(json_extract(CAST(readfile(CAST(X'$PACKAGE_HEX' AS TEXT)) AS TEXT),'\$.version'),'');" \
      2>/dev/null || true)
    printf 'Serverpaket: %s\n' "${PACKAGE_INFO:-unbekannt}"
  fi
  printf 'SQLite: %s\n' "$(sqlite3 --version | awk '{print $1}')"
  if command -v node >/dev/null 2>&1; then printf 'Node.js: %s\n' "$(node --version 2>/dev/null || true)"; fi
  printf 'Betriebssystem: %s\n' "$(uname -srm 2>/dev/null || printf 'unbekannt')"
  printf 'App-Datei: %s\n' "${APP_BASIS:-nicht eindeutig angegeben}"
  if [[ -n ${APP_BASIS:-} ]]; then
    printf 'App-SHA-256: %s\n' "$(sha_datei "$BETRIEB/anwendung/$APP_BASIS")"
  fi
  printf 'Build-ID: %s\n' "${BUILD_ID_WERT:-nicht gesetzt}"
  printf 'Git-Commit: %s\n' "${GIT_COMMIT:-nicht ermittelbar}"
  if [[ -f $BETRIEB/konfiguration/Dockerfile ]]; then
    printf 'Dockerfile-SHA-256: %s\n' "$(sha_datei "$BETRIEB/konfiguration/Dockerfile")"
    BASISIMAGE=$(awk 'toupper($1)=="FROM" {print $2; exit}' "$BETRIEB/konfiguration/Dockerfile")
    printf 'Container-Basisimage: %s\n' "${BASISIMAGE:-nicht ermittelbar}"
  fi
  if [[ -f $BETRIEB/konfiguration/package-lock.json ]]; then
    printf 'package-lock.json-SHA-256: %s\n' "$(sha_datei "$BETRIEB/konfiguration/package-lock.json")"
  fi
  if [[ -f $BETRIEB/konfiguration/.dockerignore ]]; then
    printf '.dockerignore-SHA-256: %s\n' "$(sha_datei "$BETRIEB/konfiguration/.dockerignore")"
  fi
  if [[ -f $SERVER_QUELLARCHIV ]]; then
    printf 'Server-Quellarchiv: %s\n' "${SERVER_QUELLARCHIV##*/}"
    printf 'Server-Quellarchiv-SHA-256: %s\n' "$(sha_datei "$SERVER_QUELLARCHIV")"
    printf 'Server-Quellarchiv-Bytes: %s\n' \
      "$(wc -c < "$SERVER_QUELLARCHIV" | tr -d ' ')"
    printf 'Server-Quelldateien: %d\n' "${#SERVER_QUELLDATEIEN[@]}"
  else
    printf 'Server-Quellarchiv: FEHLT\n'
  fi
  printf '\nAktive nichtgeheime Laufzeitkonfiguration:\n'
  for KONFIG_NAME in \
    NODE_ENV PORT COOKIE_SECURE CALENDAR_SYNC_INTERVAL_SECONDS MAILBOX_WATCH \
    REQUEST_TIMEOUT_MS ENABLE_DOCUMENT_MIGRATION EXT_AI_PROVIDER \
    EXT_UPDATE_VERSION APP_FILE OUTPUTS_DIR RUNTIME_ROOT DB_PATH DATA_DIR \
    DOCUMENTS_DATA_ROOT EXTENSION_ARTIFACTS_DIR \
    TOTAL_BACKUP_DESTINATION TOTAL_BACKUP_RESTIC_ENV_FILE \
    TOTAL_BACKUP_OFFSITE_MAINTENANCE_STATUS_DIR \
    TOTAL_BACKUP_OFFSITE_MAINTENANCE_MAX_AGE_HOURS \
    DOCUMENT_RECOVERY_KEY_FILE APP_IMAGE_REFERENCE APP_IMAGE; do
    printf '%s: %s\n' "$KONFIG_NAME" "$(inventar_umgebungswert "$KONFIG_NAME")"
  done
  for KONFIG_NAME in \
    PUBLIC_BASE_URL DOK_GRAPH_BASE EXT_UPDATE_XPI_URL \
    DOK_MS_AUTH DOK_MS_TOKEN DOK_GD_AUTH DOK_GD_TOKEN DOK_GD_API DOK_GD_UPLOAD; do
    printf '%s: %s\n' "$KONFIG_NAME" "$(inventar_urlwert "$KONFIG_NAME")"
  done
  printf 'DB- und Dokumentwurzel: siehe PRUEFBERICHT.txt und verwaltung/WURZELN.tsv\n'
  printf 'Geheimnisse: .env, runtime/secrets, SESSION_SECRET, ENCRYPTION_KEY, DOCUMENT_RECOVERY_KEY, SETUP_TOKEN, Mail-/Cloud-Tokens, Recovery-Key und restic-Passwort bewusst ausgeschlossen\n'
  printf '\nBrowser-Erweiterungspakete:\n'
  ERWEITERUNG_GEFUNDEN=0
  while IFS= read -r -d '' E_DATEI; do
    E_REL=${E_DATEI#"$BETRIEB/browser-erweiterungen/"}
    printf '%s  %s  %s Bytes\n' "$(sha_datei "$E_DATEI")" "$E_REL" \
      "$(wc -c < "$E_DATEI" | tr -d ' ')"
    ERWEITERUNG_GEFUNDEN=1
  done < <(find "$BETRIEB/browser-erweiterungen" -type f -print0)
  ((ERWEITERUNG_GEFUNDEN)) || printf 'keine\n'
} > "$INVENTAR"

while IFS= read -r -d '' BETRIEBS_LINK; do
  befund "Symbolischer Link in den Betriebsartefakten ist nicht zulaessig: ${BETRIEBS_LINK#"$STAGE/"}"
done < <(find "$BETRIEB" -type l -print0)
while IFS= read -r -d '' BETRIEBS_SPEZIAL; do
  befund "Spezialdatei in den Betriebsartefakten ist nicht zulaessig: ${BETRIEBS_SPEZIAL#"$STAGE/"}"
done < <(find "$BETRIEB" ! -type f ! -type d ! -type l -print0)

# Rettungswerkzeug und Klartextanleitung liegen in jedem Snapshot obenauf.
[[ -f $SCRIPT_DIR/notfall-rettung.sh ]] ||
  { printf '%s: notfall-rettung.sh fehlt neben dem Sicherungsskript.\n' "$PROGRAMM" >&2; exit 72; }
[[ -f $SCRIPT_DIR/gesamt-restore.sh ]] ||
  { printf '%s: gesamt-restore.sh fehlt neben dem Sicherungsskript.\n' "$PROGRAMM" >&2; exit 72; }
[[ -f $SCRIPT_DIR/../docs/NOTFALL-KURZANLEITUNG.txt ]] ||
  { printf '%s: Einseitige Nachfolger-Kurzanleitung fehlt.\n' "$PROGRAMM" >&2; exit 72; }
[[ -f $SCRIPT_DIR/../docs/NOTFALL-WIEDERHERSTELLUNG.txt ]] ||
  { printf '%s: Ausfuehrliche Nachfolger-Anleitung fehlt.\n' "$PROGRAMM" >&2; exit 72; }
kopiere_laufzeitdatei_konsistent "$0" "$STAGE/GESAMT-BACKUP.sh" \
  "Gesamtsicherungsskript" || exit 2
kopiere_laufzeitdatei_konsistent "$SCRIPT_DIR/notfall-rettung.sh" \
  "$STAGE/NOTFALL-RETTUNG.sh" "Rettungsskript" || exit 2
kopiere_laufzeitdatei_konsistent "$SCRIPT_DIR/gesamt-restore.sh" \
  "$STAGE/GESAMT-RESTORE.sh" "Wiederherstellungsskript" || exit 2
kopiere_laufzeitdatei_konsistent "$SCRIPT_DIR/../docs/NOTFALL-KURZANLEITUNG.txt" \
  "$STAGE/ANLEITUNG.txt" "Notfall-Kurzanleitung" || exit 2
kopiere_laufzeitdatei_konsistent "$SCRIPT_DIR/../docs/NOTFALL-WIEDERHERSTELLUNG.txt" \
  "$STAGE/DETAILANLEITUNG.txt" "Notfall-Detailanleitung" || exit 2
chmod 700 "$STAGE/GESAMT-BACKUP.sh" "$STAGE/NOTFALL-RETTUNG.sh" "$STAGE/GESAMT-RESTORE.sh"

KAPAZITAET_WARNUNG=
if ((KAPAZITAET_PROZENT > 0 || KAPAZITAET_BYTES > 0)); then
  DF_WERTE=$(df -Pk "$ZIEL_BASIS" | awk 'END {
    gsub(/%/,"",$5);
    if ($4 ~ /^[0-9]+$/ && $5 ~ /^[0-9]+$/) print $4 "|" (100-$5)
  }')
  if [[ -n $DF_WERTE ]]; then
    IFS='|' read -r FREI_KB FREI_PROZENT <<< "$DF_WERTE"
    FREI_BYTES=$((FREI_KB * 1024))
    if ((KAPAZITAET_BYTES > 0 && FREI_BYTES <= KAPAZITAET_BYTES)); then
      KAPAZITAET_WARNUNG="Nur $FREI_BYTES Bytes frei (Warngrenze $KAPAZITAET_BYTES Bytes)."
    fi
    if ((KAPAZITAET_PROZENT > 0 && FREI_PROZENT <= KAPAZITAET_PROZENT)); then
      if [[ -n $KAPAZITAET_WARNUNG ]]; then KAPAZITAET_WARNUNG="$KAPAZITAET_WARNUNG "; fi
      KAPAZITAET_WARNUNG="${KAPAZITAET_WARNUNG}Nur $FREI_PROZENT % frei (Warngrenze $KAPAZITAET_PROZENT %)."
    fi
    if [[ -n $KAPAZITAET_WARNUNG ]]; then
      hinweis "KAPAZITAETSWARNUNG: $KAPAZITAET_WARNUNG"
    else
      hinweis "Zielkapazitaet: $FREI_BYTES Bytes ($FREI_PROZENT %) frei; Warngrenzen nicht erreicht."
    fi
  else
    hinweis "Freier Platz des Sicherungsziels konnte nicht ermittelt werden."
  fi
fi

{
  printf '\nZusammenfassung:\n'
  printf 'Metadaten-Dateien erwartet: %d\n' "$ERWARTET"
  printf 'Metadaten-Dateien gefunden und geprueft: %d\n' "$GEPRUEFT"
  printf 'Fehler: %d\n' "$FEHLER"
  printf 'Ende (lokal): %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
} >> "$BERICHT"

if ((FEHLER)); then
  printf 'UNVOLLSTAENDIG\n' > "$STAGE/STATUS.txt"
else
  printf 'VOLLSTAENDIG\n' > "$STAGE/STATUS.txt"
fi

MANIFEST_TEIL=$STAGE/verwaltung/.MANIFEST.tsv.part
: > "$MANIFEST_TEIL"
while IFS= read -r -d '' DATEI; do
  REL=${DATEI#"$STAGE/"}
  [[ $REL == verwaltung/.MANIFEST.tsv.part ]] && continue
  HASH=$(sha_datei "$DATEI")
  GROESSE=$(wc -c < "$DATEI" | tr -d ' ')
  printf '%s\t%s\t%s\n' "$HASH" "$GROESSE" "$(b64 "$REL")" >> "$MANIFEST_TEIL"
done < <(find "$STAGE" -type f -print0)
mv -- "$MANIFEST_TEIL" "$STAGE/MANIFEST.tsv"
sha_datei "$STAGE/MANIFEST.tsv" > "$STAGE/MANIFEST.tsv.sha256"
if ((FEHLER == 0)) && ! pruefe_manifest_inhalt "$STAGE"; then
  printf '%s: Der fertige Arbeitsstand stimmt nicht vollständig mit seinem Manifest überein; er wird nicht veröffentlicht.\n' \
    "$PROGRAMM" >&2
  exit 2
fi

ZEIT=$(date '+%Y%m%d_%H%M%S')
SAUBER_LABEL=
if [[ -n $BEZEICHNUNG ]]; then
  SAUBER_LABEL=$(printf '%s' "$BEZEICHNUNG" | tr -cs '[:alnum:]_.-' '_' | sed 's/^_*//;s/_*$//' | cut -c1-48)
fi
NAME=Gesamtsicherung_${ZEIT}_job-$JOB_TOKEN
[[ -z $SAUBER_LABEL ]] || NAME=${NAME}_$SAUBER_LABEL
((FEHLER == 0)) || NAME=${NAME}_UNVOLLSTAENDIG
FINAL=$ZIEL_BASIS/$NAME
NR=2
while [[ -e $FINAL ]]; do
  FINAL=$ZIEL_BASIS/${NAME}_$NR
  NR=$((NR + 1))
done

ziel_vor_veroeffentlichung_pruefen
mv -- "$STAGE" "$FINAL"
rm -f -- "$STAGE_OWNER"
STAGE_OWNER=
STAGE=
# Eine zweite Zielprüfung nach dem Rename erkennt auch einen Austausch im
# letzten verbleibenden Pfadfenster. Es folgt niemals ein Erfolgssignal, wenn
# die veröffentlichte Generation nicht mehr am gebundenen Ziel liegt.
ziel_vor_veroeffentlichung_pruefen
if ((FEHLER)); then
  dauerhaft_synchronisieren "$FINAL" "$ZIEL_BASIS" || {
    printf '%s: Diagnose-Snapshot konnte nicht dauerhaft auf das Ziel geschrieben werden.\n' \
      "$PROGRAMM" >&2
    exit 74
  }
  printf 'DIAGNOSE_SNAPSHOT=%s\n' "$FINAL"
  printf 'STATUS=UNVOLLSTAENDIG FEHLER=%d\n' "$FEHLER"
  diagnose_retention_anwenden
  exit 2
fi

if ! pruefe_snapshot_manifest "$FINAL"; then
  printf '%s: Der veröffentlichte Snapshot hat die vollständige Manifestprüfung nicht bestanden; es wird kein Erfolg gemeldet.\n' \
    "$PROGRAMM" >&2
  exit 2
fi
if [[ $OFFSITE_MODE == restic ]]; then
  # Der dauerhafte Pending-Nachweis gehört zur lokalen Veröffentlichung. Er
  # steht damit bereits vor SNAPSHOT= und vor jedem Remote-Byte. Ein harter
  # Abbruch kann keine nie hochgeladene Generation mehr als bestätigt aussehen
  # lassen.
  offsite_pending_schreiben "$FINAL" || exit 74
fi
dauerhaft_synchronisieren "$FINAL" "$ZIEL_BASIS" || {
  printf '%s: Snapshot konnte nicht dauerhaft auf das Ziel geschrieben werden; es wird kein Erfolg gemeldet.\n' \
    "$PROGRAMM" >&2
  exit 74
}
if ! pruefe_snapshot_manifest "$FINAL"; then
  printf '%s: Snapshot ist nach dem dauerhaften Flush nicht mehr manifesttreu; es wird kein Erfolg gemeldet.\n' \
    "$PROGRAMM" >&2
  exit 2
fi
printf 'SNAPSHOT=%s\n' "$FINAL"

if [[ -n $KAPAZITAET_WARNUNG ]]; then
  printf 'WARNUNG=KAPAZITAET %s\n' "$KAPAZITAET_WARNUNG"
fi

# Restic verschlüsselt und authentifiziert jeden Inhalt clientseitig. Ob das
# Ziel zusätzlich unveränderbar ist, wird am Repository selbst eingerichtet
# (z.B. append-only rest-server oder S3 Object Lock). Sobald das Profil aktiv
# ist, ist ein fehlgeschlagener Zweitkopie-Lauf ein Fehler des Gesamtjobs.
if [[ $OFFSITE_MODE == restic ]]; then
  if offsite_uebertragen "$FINAL" neu; then
    OFFSITE_RC=0
  else
    OFFSITE_RC=$?
  fi
  if ((OFFSITE_RC == 0)); then
    # Erst nachdem die aktuelle Generation remote gesichert ist, wird genau
    # eine ältere Warteschlangenposition nachgeholt.
    offsite_pending_fortsetzen || true
    offsite_pending_reparieren
    offsite_retention_anwenden
  else
    offsite_pending_begrenzen
    retention_anwenden
    printf 'LOCAL_STATUS=VOLLSTAENDIG OFFSITE_STATUS=FEHLER SNAPSHOT=%s\n' "$FINAL"
    if [[ $OFFSITE_REQUIRED == yes ]]; then
      exit "$OFFSITE_RC"
    fi
    printf 'WARNUNG=OFFSITE_NICHT_ERFORDERLICH RC=%d\n' "$OFFSITE_RC"
  fi
  offsite_pending_begrenzen
fi

retention_anwenden
printf 'STATUS=VOLLSTAENDIG DATEIEN=%d\n' "$GEPRUEFT"
exit 0
