#!/usr/bin/env bash
#
# Kontrollierte Wiederherstellung einer Betreuungsbüro-Gesamtsicherung.
# Vorgabe ist ein rein lesender Dry-run. Ein echter Tausch erfordert sowohl
# --apply als auch die ausdrückliche Bestätigung, dass die App gestoppt ist.

set -euo pipefail
IFS=$'\n\t'
umask 077

PROGRAMM=${0##*/}
SNAPSHOT=
SERVER_DIR=
DATA_TARGET=
DB_TARGET=
APPLY=0
APP_STOPPED=0
ALLOW_VERSION_MISMATCH=0
EXTERNAL_ROOT_BASE=
RESTORE_RUNTIME_ARTIFACTS=0
OUTPUTS_TARGET=
TEMPLATE_TARGET=
EXTENSION_TARGET=
STAGE=
DB_STAGE=
EXTERNAL_STAGE=
EXTENSION_STAGE=
TEMPLATE_STAGE=
APP_STAGE=
ROLLBACK=
JOURNAL=
ROLLBACK_REFERENCES=
DATA_ROLLBACK=
DB_ROLLBACK=
EXTERNAL_ROLLBACK=
RUNTIME_ROLLBACK=
EXTENSION_ROLLBACK=
APP_ROLLBACK=
DATA_OLD=
DB_OLD=
EXTERNAL_OLD=
EXTENSION_OLD=
TEMPLATE_OLD=
APP_OLD=
DATA_FAILED=
DB_FAILED=
EXTERNAL_FAILED=
EXTENSION_FAILED=
TEMPLATE_FAILED=
APP_FAILED=
RESTORE_PROGRESS_MARKER=
RESTORE_PROGRESS_ACTIVE=0
RESTORE_COMMITTED=0
DATA_NEW_ACTIVE=0
DB_NEW_ACTIVE=0
EXTERNAL_NEW_ACTIVE=0
EXTENSION_NEW_ACTIVE=0
TEMPLATE_NEW_ACTIVE=0
APP_NEW_ACTIVE=0
VERIFY_LIST=
ROOT_MAP=
MANIFEST_SAFE=
ROOTS_SAFE=

usage() {
  cat <<'EOF'
Aufruf:
  gesamt-restore.sh --snapshot ORDNER --server-dir ORDNER
                    --data-dir ORDNER --db DATEI
                    [--apply --confirm-app-stopped]
                    [--allow-version-mismatch]
                    [--external-root-base ORDNER]
                    [--restore-runtime-artifacts --outputs-dir ORDNER]

Ohne --apply wird nur geprüft und geplant. Ein echter Lauf:

  * prüft STATUS, Format und jede Manifestdatei,
  * prüft SQLite mit integrity_check und foreign_key_check,
  * vergleicht die gesicherte und installierte Serverversion,
  * baut die neue Datenwurzel vollständig in einem Staging-Ordner auf,
  * bewahrt jeden bisherigen Zielstand in dessen eigenem Dateisystem auf,
  * tauscht alle Ziele ausschließlich per atomarem rename,
  * setzt vor dem ersten Tausch einen langlebigen Restore-Fortschrittsmarker,
  * setzt .recovery-quarantine, damit Hintergrundjobs erst nach
    administrativer Prüfung wieder anlaufen,
  * schreibt unter server/_restore-rollback/ nur Journal und Zielverweise.

Externe Dokumentwurzeln aus verwaltung/WURZELN.tsv werden nie still an alte
absolute Pfade geschrieben. Sind eigenständige externe Wurzeln enthalten,
ist bei --apply ein neuer gemeinsamer Zielordner über --external-root-base
Pflicht. Der Restore baut dort alle Wurzeln manifestgeprüft auf und passt die
Dokumenten-Konfiguration der wiederhergestellten DB auf die neuen Pfade an.

--restore-runtime-artifacts stellt zusätzlich Vorlagen, hochgeladene
Browser-Erweiterungen und die ausgelieferte HTML-App wieder her. Für die App
ist --outputs-dir Pflicht.
Serverquellcode und Containerdefinitionen bleiben bewusst Wiederaufbauquellen;
sie werden nie über eine bestehende Installation kopiert.

Ein Ziel darf nicht selbst ein Mountpoint sein. Bei Docker/NAS wird der
Datenträger am Elternordner eingehängt und ein Unterordner als --data-dir,
--external-root-base beziehungsweise --outputs-dir verwendet. Nur so bleiben
Aktivierung und Rollback atomare Renames im selben Dateisystem.
EOF
}

die() {
  printf '%s: %s\n' "$PROGRAMM" "$*" >&2
  exit 64
}

fortschrittsmarker_entfernen() {
  [[ -n ${RESTORE_PROGRESS_MARKER:-} && -f $RESTORE_PROGRESS_MARKER &&
     ! -L $RESTORE_PROGRESS_MARKER ]] || return 0
  rm -f -- "$RESTORE_PROGRESS_MARKER" || return 1
  if ! sync "$(dirname -- "$RESTORE_PROGRESS_MARKER")" 2>/dev/null; then
    sync 2>/dev/null || return 1
  fi
  RESTORE_PROGRESS_ACTIVE=0
}

cleanup() {
  local rc=$? rollback_ok=1
  # Der einmal begonnene Rücktausch ist die letzte Schutzlinie. Weder ein
  # zweites Stoppsignal noch ein erneutes EXIT darf ihn halb ausgeführt lassen.
  trap '' HUP INT TERM
  trap - EXIT
  if ((rc != 0)) && [[ -n ${JOURNAL:-} ]]; then
    printf '%s FEHLER rc=%d; automatischer Rollback beginnt\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$rc" >> "$JOURNAL" || true
    if ((RESTORE_COMMITTED)); then
      printf '%s COMMIT war bereits dauerhaft; neuer Stand bleibt mit Recovery-Quarantäne aktiv\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$JOURNAL" 2>/dev/null || true
    else
    # Strikt rückwärts zur Aktivierung. Jede fehlgeschlagene neue Fassung und
    # jeder Altstand bleiben im Parent ihres eigenen Ziels; damit ist auch der
    # Rollback selbst ein Rename im selben Dateisystem.
    if ((APP_NEW_ACTIVE)) && [[ -n ${OUTPUTS_TARGET:-} && -e $OUTPUTS_TARGET ]]; then
      mv -- "$OUTPUTS_TARGET" "$APP_FAILED" 2>/dev/null || rollback_ok=0
    fi
    if [[ -n ${APP_OLD:-} && -e $APP_OLD &&
          -n ${OUTPUTS_TARGET:-} && ! -e $OUTPUTS_TARGET ]]; then
      mv -- "$APP_OLD" "$OUTPUTS_TARGET" 2>/dev/null || rollback_ok=0
    fi
    if ((EXTENSION_NEW_ACTIVE)) && [[ -e $EXTENSION_TARGET ]]; then
      mv -- "$EXTENSION_TARGET" "$EXTENSION_FAILED" 2>/dev/null || rollback_ok=0
    fi
    if [[ -n ${EXTENSION_OLD:-} && -e $EXTENSION_OLD &&
          ! -e $EXTENSION_TARGET ]]; then
      mv -- "$EXTENSION_OLD" "$EXTENSION_TARGET" 2>/dev/null || rollback_ok=0
    fi
    if ((TEMPLATE_NEW_ACTIVE)) && [[ -e $TEMPLATE_TARGET ]]; then
      mv -- "$TEMPLATE_TARGET" "$TEMPLATE_FAILED" 2>/dev/null || rollback_ok=0
    fi
    if [[ -n ${TEMPLATE_OLD:-} && -e $TEMPLATE_OLD &&
          ! -e $TEMPLATE_TARGET ]]; then
      mv -- "$TEMPLATE_OLD" "$TEMPLATE_TARGET" 2>/dev/null || rollback_ok=0
    fi
    if ((EXTERNAL_NEW_ACTIVE)) && [[ -n ${EXTERNAL_ROOT_BASE:-} && -e $EXTERNAL_ROOT_BASE ]]; then
      mv -- "$EXTERNAL_ROOT_BASE" "$EXTERNAL_FAILED" 2>/dev/null || rollback_ok=0
    fi
    if [[ -n ${EXTERNAL_OLD:-} && -e $EXTERNAL_OLD &&
          -n ${EXTERNAL_ROOT_BASE:-} && ! -e $EXTERNAL_ROOT_BASE ]]; then
      mv -- "$EXTERNAL_OLD" "$EXTERNAL_ROOT_BASE" 2>/dev/null || rollback_ok=0
    fi
    if ((DB_NEW_ACTIVE)) && [[ -e $DB_TARGET ]]; then
      mv -- "$DB_TARGET" "$DB_FAILED" 2>/dev/null || rollback_ok=0
    fi
    if [[ -n ${DB_OLD:-} && -e $DB_OLD && ! -e $DB_TARGET ]]; then
      mv -- "$DB_OLD" "$DB_TARGET" 2>/dev/null || rollback_ok=0
    fi
    if ((DATA_NEW_ACTIVE)) && [[ -e $DATA_TARGET ]]; then
      mv -- "$DATA_TARGET" "$DATA_FAILED" 2>/dev/null || rollback_ok=0
    fi
    if [[ -n ${DATA_OLD:-} && -e $DATA_OLD && ! -e $DATA_TARGET ]]; then
      mv -- "$DATA_OLD" "$DATA_TARGET" 2>/dev/null || rollback_ok=0
    fi
    if ((rollback_ok)) && ((RESTORE_PROGRESS_ACTIVE)); then
      fortschrittsmarker_entfernen || rollback_ok=0
    fi
    if ((rollback_ok)); then
      printf '%s ROLLBACK vollständig; alter Zielzustand ist wieder aktiv\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$JOURNAL" 2>/dev/null || true
    else
      printf '%s ROLLBACK UNVOLLSTÄNDIG; Restore-Fortschrittsmarker bleibt fail-closed liegen\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$JOURNAL" 2>/dev/null || true
    fi
    fi
  fi
  if [[ -n ${STAGE:-} && -d $STAGE ]]; then rm -rf -- "$STAGE"; fi
  if [[ -n ${EXTERNAL_STAGE:-} && -d $EXTERNAL_STAGE ]]; then rm -rf -- "$EXTERNAL_STAGE"; fi
  if [[ -n ${EXTENSION_STAGE:-} && -d $EXTENSION_STAGE ]]; then rm -rf -- "$EXTENSION_STAGE"; fi
  if [[ -n ${TEMPLATE_STAGE:-} && -d $TEMPLATE_STAGE ]]; then rm -rf -- "$TEMPLATE_STAGE"; fi
  if [[ -n ${APP_STAGE:-} && -d $APP_STAGE ]]; then rm -rf -- "$APP_STAGE"; fi
  if [[ -n ${DB_STAGE:-} && -f $DB_STAGE ]]; then rm -f -- "$DB_STAGE"; fi
  if [[ -n ${VERIFY_LIST:-} && -f $VERIFY_LIST ]]; then rm -f -- "$VERIFY_LIST"; fi
  if [[ -n ${ROOT_MAP:-} && -f $ROOT_MAP ]]; then rm -f -- "$ROOT_MAP"; fi
  if [[ -n ${MANIFEST_SAFE:-} && -f $MANIFEST_SAFE ]]; then rm -f -- "$MANIFEST_SAFE"; fi
  if [[ -n ${ROOTS_SAFE:-} && -f $ROOTS_SAFE ]]; then rm -f -- "$ROOTS_SAFE"; fi
  exit "$rc"
}
signal_abbruch() {
  local code=$1
  # Sobald der kontrollierte Rollback begonnen hat, dürfen weitere normale
  # Stoppsignale ihn nicht mitten im Zurücktausch unterbrechen. SIGKILL bleibt
  # naturgemäß nicht abfangbar; dafür liegt der externe Fortschrittsmarker.
  trap '' HUP INT TERM
  exit "$code"
}
trap cleanup EXIT
trap 'signal_abbruch 129' HUP
trap 'signal_abbruch 130' INT
trap 'signal_abbruch 143' TERM

while (($#)); do
  case "$1" in
    --snapshot) (($# >= 2)) || die "--snapshot braucht einen Wert."; SNAPSHOT=$2; shift 2 ;;
    --server-dir) (($# >= 2)) || die "--server-dir braucht einen Wert."; SERVER_DIR=$2; shift 2 ;;
    --data-dir) (($# >= 2)) || die "--data-dir braucht einen Wert."; DATA_TARGET=$2; shift 2 ;;
    --db) (($# >= 2)) || die "--db braucht einen Wert."; DB_TARGET=$2; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --confirm-app-stopped) APP_STOPPED=1; shift ;;
    --allow-version-mismatch) ALLOW_VERSION_MISMATCH=1; shift ;;
    --external-root-base)
      (($# >= 2)) || die "--external-root-base braucht einen Wert."
      EXTERNAL_ROOT_BASE=$2
      shift 2
      ;;
    --restore-runtime-artifacts) RESTORE_RUNTIME_ARTIFACTS=1; shift ;;
    --outputs-dir)
      (($# >= 2)) || die "--outputs-dir braucht einen Wert."
      OUTPUTS_TARGET=$2
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unbekanntes Argument: $1" ;;
  esac
done

[[ -n $SNAPSHOT && -n $SERVER_DIR && -n $DATA_TARGET && -n $DB_TARGET ]] ||
  die "--snapshot, --server-dir, --data-dir und --db sind Pflicht."
[[ -d $SNAPSHOT && ! -L $SNAPSHOT ]] || die "Snapshot fehlt oder ist ein Link."
[[ -d $SERVER_DIR && ! -L $SERVER_DIR ]] || die "Server-Verzeichnis fehlt oder ist ein Link."
[[ $DATA_TARGET == /* && $DB_TARGET == /* ]] || die "Zielpfade müssen absolut sein."
[[ $DATA_TARGET != / && $SERVER_DIR != / ]] || die "Wurzelverzeichnisse sind keine zulässigen Ziele."
if [[ -n $EXTERNAL_ROOT_BASE && $EXTERNAL_ROOT_BASE != /* ]]; then
  die "--external-root-base muss absolut sein."
fi
if [[ -n $OUTPUTS_TARGET && $OUTPUTS_TARGET != /* ]]; then
  die "--outputs-dir muss absolut sein."
fi
if ((RESTORE_RUNTIME_ARTIFACTS)) && [[ -z $OUTPUTS_TARGET ]]; then
  die "--restore-runtime-artifacts braucht --outputs-dir."
fi
if ((APPLY && !APP_STOPPED)); then
  die "--apply ist nur zusammen mit --confirm-app-stopped zulässig."
fi

for tool in sqlite3 find wc base64 awk grep sort uniq mktemp mv cp df du node rm sync; do
  command -v "$tool" >/dev/null 2>&1 || die "Benötigtes Werkzeug fehlt: $tool"
done
if command -v shasum >/dev/null 2>&1; then
  sha_file() { shasum -a 256 -- "$1" | awk '{print $1}'; }
  sha_text() { shasum -a 256 | awk '{print $1}'; }
elif command -v sha256sum >/dev/null 2>&1; then
  sha_file() { sha256sum -- "$1" | awk '{print $1}'; }
  sha_text() { sha256sum | awk '{print $1}'; }
else
  die "SHA-256-Werkzeug fehlt."
fi
if printf 'Zg==' | base64 -d >/dev/null 2>&1; then B64=-d
elif printf 'Zg==' | base64 -D >/dev/null 2>&1; then B64=-D
else die "base64 kann nicht dekodieren."
fi
b64_encode() { base64 | tr -d '\n'; }

fortschrittsmarker_pfad() {
  node - "$1" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const raw = path.resolve(process.argv[2]);
const parent = fs.realpathSync(path.dirname(raw));
const canonical = path.join(parent, path.basename(raw));
const id = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 24);
process.stdout.write(path.join(parent, `.betreuungsbuero-restore-in-progress-${id}`));
NODE
}

fortschrittsmarker_schreiben() {
  node - "$1" "$2" "$3" <<'NODE'
const fs = require('fs');
const path = require('path');
const [file, snapshot, dataTargetHash] = process.argv.slice(2);
if (!/^[^/\\\0\r\n\t]{1,255}$/.test(snapshot)) {
  throw new Error('Der Snapshotname ist für den Restore-Fortschrittsmarker ungültig.');
}
if (!/^[0-9a-f]{64}$/i.test(dataTargetHash)) {
  throw new Error('Der Datenziel-Hash des Restore-Fortschrittsmarkers ist ungültig.');
}
const content = [
  'Betreuungsbuero-Restore-In-Progress/1',
  `STARTED_AT=${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
  `SNAPSHOT=${snapshot}`,
  `DATA_TARGET_SHA256=${dataTargetHash.toLowerCase()}`,
  'STATE=ACTIVATING',
  ''
].join('\n');
const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT
  | fs.constants.O_EXCL | noFollow, 0o600);
try {
  fs.writeFileSync(fd, content, 'utf8');
  fs.fsyncSync(fd);
} finally {
  fs.closeSync(fd);
}
try {
  const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
} catch (_error) {
  // Manche Dateisysteme erlauben kein Verzeichnis-fsync; der anschließende
  // globale sync im Shellskript bleibt verpflichtend.
}
NODE
}

ziel_mountstatus() {
  node - "$1" <<'NODE'
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const input = path.resolve(process.argv[2]);
if (!fs.existsSync(input)) {
  process.stdout.write('regular');
  process.exit(0);
}
const target = fs.realpathSync(input);
const parent = fs.realpathSync(path.dirname(target));
let mounted = fs.statSync(target).dev !== fs.statSync(parent).dev;
if (!mounted && process.platform === 'linux') {
  try {
    const decode = (value) => value.replace(/\\([0-7]{3})/g, (_match, octal) =>
      String.fromCharCode(Number.parseInt(octal, 8)));
    const lines = fs.readFileSync('/proc/self/mountinfo', 'utf8').split(/\r?\n/);
    mounted = lines.some((line) => {
      const fields = line.split(' ');
      return fields.length > 5 && path.resolve(decode(fields[4])) === target;
    });
  } catch (_error) {
    // Der Gerätevergleich bleibt der sichere Mindestnachweis.
  }
}
if (!mounted && process.platform === 'darwin') {
  try {
    const mount = childProcess.execFileSync('/usr/bin/stat', ['-f', '%m', target], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    mounted = path.resolve(mount) === target;
  } catch (_error) {
    // Der Gerätevergleich bleibt der sichere Mindestnachweis.
  }
}
process.stdout.write(mounted ? 'mountpoint' : 'regular');
NODE
}

mountpoint_ausschliessen() {
  local ziel=$1 bezeichnung=$2 status
  [[ -e $ziel ]] || return 0
  status=$(ziel_mountstatus "$ziel") ||
    die "Der Mountpoint-Status für $bezeichnung konnte nicht sicher ermittelt werden."
  [[ $status == regular ]] ||
    die "$bezeichnung ist selbst ein Mountpoint und kann nicht atomar getauscht werden." \
      "Den Datenträger/Container-Volume an seinem Elternordner einhängen und einen Unterordner als Ziel verwenden."
  return 0
}

SNAPSHOT=$(CDPATH= cd -- "$SNAPSHOT" && pwd -P)
SERVER_DIR=$(CDPATH= cd -- "$SERVER_DIR" && pwd -P)

# Restore-Ziele werden nicht nur lexikalisch zusammengesetzt. Insbesondere ein
# letztes "."/"..", ein leerer Basename nach "/" oder ein ausgetauschter
# Symlink-Elternpfad könnte einen späteren atomaren Tausch sonst auf einen viel
# breiteren Ordner umlenken. Der Vertrag verlangt deshalb einen einfachen
# letzten Namen und einen bereits vorhandenen, regulären, kanonischen Elternpfad.
sicheres_restore_ziel() {
  local roh=$1 bezeichnung=$2 parent basis kanon_parent
  [[ $roh == /* ]] || die "$bezeichnung muss absolut sein."
  [[ $roh != / && $roh != */ ]] ||
    die "$bezeichnung darf weder die Wurzel noch mit einem Schrägstrich enden."
  [[ $roh != *$'\n'* && $roh != *$'\r'* && $roh != *$'\t'* ]] ||
    die "$bezeichnung enthält unzulässige Steuerzeichen."
  case "$roh/" in
    */../*|*/./*) die "$bezeichnung enthält einen unsicheren Pfadabschnitt." ;;
  esac
  [[ $roh != *'//'* ]] || die "$bezeichnung enthält einen leeren Pfadabschnitt."
  basis=${roh##*/}
  [[ -n $basis && $basis != . && $basis != .. ]] ||
    die "$bezeichnung besitzt keinen sicheren letzten Pfadnamen."
  parent=$(dirname -- "$roh")
  [[ -d $parent && ! -L $parent ]] ||
    die "Der Elternordner für $bezeichnung muss bereits als regulärer, direkter Ordner existieren."
  kanon_parent=$(CDPATH= cd -- "$parent" && pwd -P) ||
    die "Der Elternordner für $bezeichnung konnte nicht kanonisch aufgelöst werden."
  [[ $kanon_parent == /* && $kanon_parent != / || $parent == / ]] ||
    die "Der Elternordner für $bezeichnung ist nicht sicher."
  [[ ! -L $kanon_parent/$basis ]] ||
    die "$bezeichnung darf kein symbolischer Link sein."
  printf '%s/%s\n' "${kanon_parent%/}" "$basis"
}

DATA_TARGET=$(sicheres_restore_ziel "$DATA_TARGET" "das Datenziel")
DB_TARGET=$(sicheres_restore_ziel "$DB_TARGET" "das Datenbankziel")
DATA_PARENT=$(dirname -- "$DATA_TARGET")
DB_PARENT=$(dirname -- "$DB_TARGET")
RUNTIME_TARGET=$DATA_PARENT
case "$DB_TARGET/" in
  "$DATA_TARGET/"*) DB_INSIDE_DATA=1 ;;
  *) DB_INSIDE_DATA=0 ;;
esac
if [[ -n $EXTERNAL_ROOT_BASE ]]; then
  EXTERNAL_ROOT_BASE=$(sicheres_restore_ziel \
    "$EXTERNAL_ROOT_BASE" "das Ziel für externe Dokumentwurzeln")
  EXTERNAL_PARENT=$(dirname -- "$EXTERNAL_ROOT_BASE")
fi
if [[ -n $OUTPUTS_TARGET ]]; then
  OUTPUTS_TARGET=$(sicheres_restore_ziel "$OUTPUTS_TARGET" "das App-Ausgabeziel")
  OUTPUTS_PARENT=$(dirname -- "$OUTPUTS_TARGET")
fi
if ((RESTORE_RUNTIME_ARTIFACTS)); then
  TEMPLATE_TARGET=$(sicheres_restore_ziel \
    "$SERVER_DIR/assets/templates" "das Ziel für Servervorlagen")
  EXTENSION_TARGET=$(sicheres_restore_ziel \
    "$RUNTIME_TARGET/extension-artifacts" "das Ziel für Browser-Erweiterungen")
  TEMPLATE_PARENT=$(dirname -- "$TEMPLATE_TARGET")
  EXTENSION_PARENT=$(dirname -- "$EXTENSION_TARGET")
fi

[[ ! -e $DATA_TARGET || ( -d $DATA_TARGET && ! -L $DATA_TARGET ) ]] ||
  die "Das Datenziel muss ein regulärer Ordner sein."
[[ ! -e $DB_TARGET || ( -f $DB_TARGET && ! -L $DB_TARGET ) ]] ||
  die "Das Datenbankziel muss eine reguläre Datei sein."
if [[ -n $EXTERNAL_ROOT_BASE ]]; then
  [[ ! -e $EXTERNAL_ROOT_BASE ||
     ( -d $EXTERNAL_ROOT_BASE && ! -L $EXTERNAL_ROOT_BASE ) ]] ||
    die "Das Ziel für externe Dokumentwurzeln muss ein regulärer Ordner sein."
fi
if [[ -n $OUTPUTS_TARGET ]]; then
  [[ ! -e $OUTPUTS_TARGET || ( -d $OUTPUTS_TARGET && ! -L $OUTPUTS_TARGET ) ]] ||
    die "Das App-Ausgabeziel muss ein regulärer Ordner sein."
fi

mountpoint_ausschliessen "$DATA_TARGET" "Das Datenziel"
mountpoint_ausschliessen "$DB_TARGET" "Das Datenbankziel"
if [[ -n $EXTERNAL_ROOT_BASE ]]; then
  mountpoint_ausschliessen "$EXTERNAL_ROOT_BASE" \
    "Das Ziel für externe Dokumentwurzeln"
fi
if ((RESTORE_RUNTIME_ARTIFACTS)); then
  mountpoint_ausschliessen "$TEMPLATE_TARGET" "Das Ziel für Servervorlagen"
  mountpoint_ausschliessen "$EXTENSION_TARGET" \
    "Das Ziel für Browser-Erweiterungen"
  mountpoint_ausschliessen "$OUTPUTS_TARGET" "Das App-Ausgabeziel"
fi

RESTORE_PROGRESS_MARKER=$(fortschrittsmarker_pfad "$DATA_TARGET") ||
  die "Der Pfad des Restore-Fortschrittsmarkers konnte nicht bestimmt werden."
if [[ -e $RESTORE_PROGRESS_MARKER ]]; then
  die "Ein früherer Restore-Fortschrittsmarker ist noch vorhanden: $RESTORE_PROGRESS_MARKER." \
    "Die im Marker/Journaleintrag genannte Wiederherstellung zuerst kontrolliert abschließen oder zurückrollen; den Marker niemals ungeprüft löschen."
fi

ist_unterhalb() {
  local kind=$1 eltern=$2
  [[ $kind == "$eltern" || $kind == "$eltern/"* ]]
}
ZIELE_UEBERLAPPEN=0
if ist_unterhalb "$SNAPSHOT" "$DATA_TARGET" ||
   ist_unterhalb "$DATA_TARGET" "$SNAPSHOT" ||
   ist_unterhalb "$DB_TARGET" "$SNAPSHOT" ||
   ist_unterhalb "$SNAPSHOT" "$SERVER_DIR" ||
   ist_unterhalb "$SERVER_DIR" "$SNAPSHOT"; then
  ZIELE_UEBERLAPPEN=1
fi
if [[ -n $EXTERNAL_ROOT_BASE ]] && {
   ist_unterhalb "$SNAPSHOT" "$EXTERNAL_ROOT_BASE" ||
   ist_unterhalb "$EXTERNAL_ROOT_BASE" "$SNAPSHOT" ||
   ist_unterhalb "$EXTERNAL_ROOT_BASE" "$DATA_TARGET" ||
   ist_unterhalb "$DATA_TARGET" "$EXTERNAL_ROOT_BASE" ||
   ist_unterhalb "$EXTERNAL_ROOT_BASE" "$SERVER_DIR" ||
   ist_unterhalb "$SERVER_DIR" "$EXTERNAL_ROOT_BASE"
}; then
  ZIELE_UEBERLAPPEN=1
fi
if ((ZIELE_UEBERLAPPEN)); then
  die "Snapshot, Server und Wiederherstellungsziele dürfen sich nicht überlappen."
fi
if [[ -n $OUTPUTS_TARGET ]]; then
  [[ $OUTPUTS_TARGET != "$SERVER_DIR" && $OUTPUTS_TARGET != "$DATA_TARGET" &&
     $OUTPUTS_TARGET != "$EXTERNAL_ROOT_BASE" ]] ||
    die "Das App-Ausgabeziel darf keinem anderen Wiederherstellungsziel entsprechen."
  if ist_unterhalb "$OUTPUTS_TARGET" "$SNAPSHOT" ||
     ist_unterhalb "$SNAPSHOT" "$OUTPUTS_TARGET" ||
     ist_unterhalb "$OUTPUTS_TARGET" "$DATA_TARGET" ||
     ist_unterhalb "$DATA_TARGET" "$OUTPUTS_TARGET" ||
     ist_unterhalb "$OUTPUTS_TARGET" "$SERVER_DIR" ||
     ist_unterhalb "$SERVER_DIR" "$OUTPUTS_TARGET" ||
     { [[ -n $EXTERNAL_ROOT_BASE ]] &&
       { ist_unterhalb "$OUTPUTS_TARGET" "$EXTERNAL_ROOT_BASE" ||
         ist_unterhalb "$EXTERNAL_ROOT_BASE" "$OUTPUTS_TARGET"; }; }; then
    die "Das App-Ausgabeziel darf Snapshot, Server, Daten- und externe Wiederherstellungsziele nicht überlappen."
  fi
fi

[[ -f $SNAPSHOT/STATUS.txt && $(<"$SNAPSHOT/STATUS.txt") == VOLLSTAENDIG ]] ||
  die "Nur ein als VOLLSTAENDIG markierter Snapshot kann automatisch wiederhergestellt werden."
[[ -f $SNAPSHOT/verwaltung/SNAPSHOT-FORMAT.txt &&
   $(<"$SNAPSHOT/verwaltung/SNAPSHOT-FORMAT.txt") == Betreuungsbuero-Gesamtsicherung/1 ]] ||
  die "Snapshotformat fehlt oder ist unbekannt."
[[ -f $SNAPSHOT/MANIFEST.tsv && -f $SNAPSHOT/MANIFEST.tsv.sha256 ]] ||
  die "Manifest fehlt."
read -r MANIFEST_EXPECTED < "$SNAPSHOT/MANIFEST.tsv.sha256"
[[ $(sha_file "$SNAPSHOT/MANIFEST.tsv" | tr 'A-F' 'a-f') == \
   $(printf '%s' "$MANIFEST_EXPECTED" | tr 'A-F' 'a-f') ]] ||
  die "Manifest-Prüfsumme stimmt nicht."
MANIFEST_SAFE=$(mktemp "${TMPDIR:-/tmp}/betreuungsbuero-restore-signed-manifest.XXXXXXXX")
cp -p -- "$SNAPSHOT/MANIFEST.tsv" "$MANIFEST_SAFE"
[[ $(sha_file "$MANIFEST_SAFE" | tr 'A-F' 'a-f') == \
   $(printf '%s' "$MANIFEST_EXPECTED" | tr 'A-F' 'a-f') ]] ||
  die "Das Manifest wurde während der Übernahme verändert."

FILES=0
DB_MANIFEST_SHA=
DB_MANIFEST_SIZE=
ROOTS_MANIFEST_SHA=
ROOTS_MANIFEST_SIZE=
VERIFY_LIST=$(mktemp "${TMPDIR:-/tmp}/betreuungsbuero-restore-manifest.XXXXXXXX")
while IFS=$'\t' read -r expected_hash expected_size encoded; do
  [[ $expected_hash =~ ^[0-9a-fA-F]{64}$ && $expected_size =~ ^[0-9]+$ && -n $encoded ]] ||
    die "Ungültige Manifestzeile."
  rel=$(printf '%s' "$encoded" | base64 "$B64") || die "Ungültiger Base64-Pfad."
  [[ -n $rel && $rel != /* && $rel != *'//'* && $rel != *$'\n'* && $rel != *$'\r'* &&
     $rel != *$'\t'* && "/$rel/" != */../* && "/$rel/" != */./* ]] ||
    die "Unsicherer Manifestpfad."
  [[ $rel != MANIFEST.tsv && $rel != MANIFEST.tsv.sha256 ]] ||
    die "Das Manifest darf sich und seine Prüfsumme nicht selbst auflisten."
  file=$SNAPSHOT/$rel
  [[ -f $file && ! -L $file ]] || die "Manifestdatei fehlt: $rel"
  [[ $(wc -c < "$file" | tr -d ' ') == "$expected_size" ]] ||
    die "Dateigröße stimmt nicht: $rel"
  [[ $(sha_file "$file" | tr 'A-F' 'a-f') == $(printf '%s' "$expected_hash" | tr 'A-F' 'a-f') ]] ||
    die "Dateiprüfsumme stimmt nicht: $rel"
  if [[ $rel == datenbank/betreuungsbuero.sqlite3 ]]; then
    [[ -z $DB_MANIFEST_SHA ]] || die "Die SQLite-Sicherung steht mehrfach im Manifest."
    DB_MANIFEST_SHA=$(printf '%s' "$expected_hash" | tr 'A-F' 'a-f')
    DB_MANIFEST_SIZE=$expected_size
  fi
  if [[ $rel == verwaltung/WURZELN.tsv ]]; then
    [[ -z $ROOTS_MANIFEST_SHA ]] || die "Die Wurzelzuordnung steht mehrfach im Manifest."
    ROOTS_MANIFEST_SHA=$(printf '%s' "$expected_hash" | tr 'A-F' 'a-f')
    ROOTS_MANIFEST_SIZE=$expected_size
  fi
  printf '%s\n' "$rel" >> "$VERIFY_LIST"
  FILES=$((FILES + 1))
done < "$MANIFEST_SAFE"

[[ $(wc -l < "$VERIFY_LIST" | tr -d ' ') == "$FILES" ]] ||
  die "Manifestpfade mit Zeilenumbrüchen sind nicht zulässig."
[[ -z $(LC_ALL=C sort "$VERIFY_LIST" | uniq -d) ]] ||
  die "Das Manifest enthält denselben Pfad mehrfach."
[[ $DB_MANIFEST_SHA =~ ^[0-9a-f]{64}$ && $DB_MANIFEST_SIZE =~ ^[0-9]+$ ]] ||
  die "Die SQLite-Sicherung fehlt im Manifest."
while IFS= read -r -d '' special; do
  die "Der Snapshot enthält einen Link oder eine Spezialdatei: ${special#"$SNAPSHOT/"}"
done < <(find "$SNAPSHOT" ! -type f ! -type d -print0)
SNAPSHOT_FILES=$(find "$SNAPSHOT" -type f | wc -l | tr -d ' ')
[[ $SNAPSHOT_FILES == $((FILES + 2)) ]] ||
  die "Dateimenge und Manifest stimmen nicht überein; der Snapshot enthält unmanifestierte oder fehlende Dateien."

DB_SOURCE=$SNAPSHOT/datenbank/betreuungsbuero.sqlite3
[[ -f $DB_SOURCE && ! -L $DB_SOURCE ]] || die "SQLite-Sicherung fehlt."
[[ $(sqlite3 -batch -noheader "$DB_SOURCE" 'PRAGMA integrity_check;') == ok ]] ||
  die "SQLite-integrity_check ist nicht ok."
FK=$(sqlite3 -batch -noheader "$DB_SOURCE" 'PRAGMA foreign_key_check;')
[[ -z $FK ]] || die "SQLite-foreign_key_check meldet Verletzungen."

ROOT_MAP=$(mktemp "${TMPDIR:-/tmp}/betreuungsbuero-restore-roots.XXXXXXXX")
: > "$ROOT_MAP"
EXTERNAL_MAPPINGS=0
EXTERNAL_PHYSICAL=0
if [[ -f $SNAPSHOT/verwaltung/WURZELN.tsv ]]; then
  [[ $ROOTS_MANIFEST_SHA =~ ^[0-9a-f]{64}$ && $ROOTS_MANIFEST_SIZE =~ ^[0-9]+$ ]] ||
    die "Die Wurzelzuordnung fehlt im Manifest."
  ROOTS_SAFE=$(mktemp "${TMPDIR:-/tmp}/betreuungsbuero-restore-signed-roots.XXXXXXXX")
  cp -p -- "$SNAPSHOT/verwaltung/WURZELN.tsv" "$ROOTS_SAFE"
  [[ $(wc -c < "$ROOTS_SAFE" | tr -d ' ') == "$ROOTS_MANIFEST_SIZE" &&
     $(sha_file "$ROOTS_SAFE" | tr 'A-F' 'a-f') == "$ROOTS_MANIFEST_SHA" ]] ||
    die "Die Wurzelzuordnung wurde während der Übernahme verändert."
  while IFS=$'\t' read -r root_art root_id source_b64 snapshot_b64 extra; do
    [[ $root_art != Art ]] || continue
    [[ -z ${extra:-} && -n ${root_art:-} && -n ${snapshot_b64:-} ]] ||
      die "verwaltung/WURZELN.tsv enthält eine ungültige Zeile."
    case "$root_art" in
      intern) continue ;;
      STORAGE|BASE|CASE) ;;
      *) die "verwaltung/WURZELN.tsv enthält eine unbekannte Wurzelart." ;;
    esac
    root_rel=$(printf '%s' "$snapshot_b64" | base64 "$B64") ||
      die "Eine Snapshot-Wurzelzuordnung ist nicht dekodierbar."
    [[ -n $root_rel && $root_rel != /* && "/$root_rel/" != */../* &&
       $root_rel != *$'\n'* && $root_rel != *$'\r'* && $root_rel != *$'\t'* ]] ||
      die "Eine Snapshot-Wurzelzuordnung enthält einen unsicheren Pfad."
    root_target=
    case "$root_rel" in
      inhalt/server-data)
        root_target=$DATA_TARGET
        ;;
      inhalt/server-data/*)
        root_target=$DATA_TARGET/${root_rel#inhalt/server-data/}
        ;;
      inhalt/externe-dokumentwurzeln/*)
        EXTERNAL_PHYSICAL=1
        if [[ -n $EXTERNAL_ROOT_BASE ]]; then
          root_target=$EXTERNAL_ROOT_BASE/${root_rel#inhalt/externe-dokumentwurzeln/}
        fi
        ;;
      *)
        die "Eine externe Wurzel zeigt außerhalb der gesicherten Inhaltsbereiche."
        ;;
    esac
    printf '%s\t%s\t%s\t%s\n' \
      "$root_art" "$root_id" "$snapshot_b64" \
      "$(printf '%s' "$root_target" | b64_encode)" >> "$ROOT_MAP"
    EXTERNAL_MAPPINGS=$((EXTERNAL_MAPPINGS + 1))
  done < "$ROOTS_SAFE"
fi
if ((APPLY && EXTERNAL_PHYSICAL)) && [[ -z $EXTERNAL_ROOT_BASE ]]; then
  die "Der Snapshot enthält eigenständige externe Dokumentwurzeln; für --apply ist --external-root-base Pflicht."
fi

BACKUP_PACKAGE=$SNAPSHOT/betrieb/konfiguration/package.json
TARGET_PACKAGE=$SERVER_DIR/package.json
if [[ -f $BACKUP_PACKAGE && -f $TARGET_PACKAGE ]]; then
  BACKUP_VERSION=$(node -p 'require(process.argv[1]).version || ""' "$BACKUP_PACKAGE")
  TARGET_VERSION=$(node -p 'require(process.argv[1]).version || ""' "$TARGET_PACKAGE")
  if [[ $BACKUP_VERSION != "$TARGET_VERSION" && $ALLOW_VERSION_MISMATCH -ne 1 ]]; then
    die "Versionsabweichung: Snapshot=$BACKUP_VERSION, Ziel=$TARGET_VERSION. Erst Code passend wiederherstellen oder --allow-version-mismatch bewusst verwenden."
  fi
fi
if [[ -f $SNAPSHOT/betrieb/konfiguration/Dockerfile &&
      -f $SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt ]]; then
  DOCKER_SHA=$(sha_file "$SNAPSHOT/betrieb/konfiguration/Dockerfile")
  grep -Fqx "Dockerfile-SHA-256: $DOCKER_SHA" "$SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt" ||
    die "Dockerfile-Hash passt nicht zum Betriebsinventar."
fi
if [[ -f $SNAPSHOT/betrieb/konfiguration/package-lock.json &&
      -f $SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt ]]; then
  LOCK_SHA=$(sha_file "$SNAPSHOT/betrieb/konfiguration/package-lock.json")
  grep -Fqx "package-lock.json-SHA-256: $LOCK_SHA" "$SNAPSHOT/betrieb/BETRIEBSINVENTAR.txt" ||
    die "Lockfile-Hash passt nicht zum Betriebsinventar."
fi

SOURCE_KB=$(du -sk "$SNAPSHOT/inhalt/server-data" | awk '{print $1}')
DB_SOURCE_KB=$(du -sk "$DB_SOURCE" | awk '{print $1}')
EXTERNAL_SOURCE_KB=0
if [[ -d $SNAPSHOT/inhalt/externe-dokumentwurzeln ]]; then
  EXTERNAL_SOURCE_KB=$(du -sk "$SNAPSHOT/inhalt/externe-dokumentwurzeln" | awk '{print $1}')
fi
RUNTIME_SOURCE_KB=0
if ((RESTORE_RUNTIME_ARTIFACTS)); then
  [[ -d $SNAPSHOT/betrieb ]] || die "Betriebsartefakte fehlen im Snapshot."
  RUNTIME_SOURCE_KB=$(du -sk "$SNAPSHOT/betrieb" | awk '{print $1}')
fi
TOTAL_SOURCE_KB=$((SOURCE_KB + DB_SOURCE_KB + EXTERNAL_SOURCE_KB + RUNTIME_SOURCE_KB))
FREE_KB=$(df -Pk "$DATA_PARENT" | awk 'END {print $4}')
[[ $SOURCE_KB =~ ^[0-9]+$ && $DB_SOURCE_KB =~ ^[0-9]+$ &&
   $EXTERNAL_SOURCE_KB =~ ^[0-9]+$ && $RUNTIME_SOURCE_KB =~ ^[0-9]+$ &&
   $FREE_KB =~ ^[0-9]+$ ]] || die "Kapazität konnte nicht ermittelt werden."
((FREE_KB > TOTAL_SOURCE_KB + 65536)) || die "Zu wenig freier Platz für Staging und Sicherheitsmarge."
DB_FREE_KB=$(df -Pk "$DB_PARENT" | awk 'END {print $4}')
[[ $DB_FREE_KB =~ ^[0-9]+$ ]] ||
  die "Kapazität des Datenbankziels konnte nicht ermittelt werden."
((DB_FREE_KB > TOTAL_SOURCE_KB + 65536)) ||
  die "Zu wenig freier Platz am Datenbankziel."
if ((EXTERNAL_PHYSICAL)) && [[ -n $EXTERNAL_ROOT_BASE ]]; then
  EXTERNAL_FREE_KB=$(df -Pk "$EXTERNAL_PARENT" | awk 'END {print $4}')
  [[ $EXTERNAL_FREE_KB =~ ^[0-9]+$ ]] || die "Kapazität des externen Wiederherstellungsziels konnte nicht ermittelt werden."
  ((EXTERNAL_FREE_KB > TOTAL_SOURCE_KB + 65536)) ||
    die "Zu wenig freier Platz am Ziel für externe Dokumentwurzeln."
fi
if ((RESTORE_RUNTIME_ARTIFACTS)); then
  SERVER_FREE_KB=$(df -Pk "$SERVER_DIR" | awk 'END {print $4}')
  OUTPUTS_FREE_KB=$(df -Pk "$OUTPUTS_PARENT" | awk 'END {print $4}')
  [[ $SERVER_FREE_KB =~ ^[0-9]+$ && $OUTPUTS_FREE_KB =~ ^[0-9]+$ ]] ||
    die "Kapazität der Ziele für Betriebsartefakte konnte nicht ermittelt werden."
  ((SERVER_FREE_KB > TOTAL_SOURCE_KB + 65536)) ||
    die "Zu wenig freier Platz am Ziel für Browser-Erweiterungen."
  ((OUTPUTS_FREE_KB > TOTAL_SOURCE_KB + 65536)) ||
    die "Zu wenig freier Platz am Ziel für Betriebsartefakte."
fi

printf 'DRY_RUN=%s\n' "$((APPLY ? 0 : 1))"
printf 'SNAPSHOT=%s\nDATEIEN=%d\nDB=OK\n' "$SNAPSHOT" "$FILES"
printf 'ZIEL_DATEN=%s\nZIEL_DB=%s\n' "$DATA_TARGET" "$DB_TARGET"
printf 'EXTERNE_WURZELZUORDNUNGEN=%d EIGENSTAENDIGE_WURZELN=%d AUTOMATISCH_ZUGEORDNET=%d\n' \
  "$EXTERNAL_MAPPINGS" "$EXTERNAL_PHYSICAL" \
  "$([[ $EXTERNAL_PHYSICAL -eq 0 || -n $EXTERNAL_ROOT_BASE ]] && printf 1 || printf 0)"
if [[ -n $EXTERNAL_ROOT_BASE ]]; then
  printf 'ZIEL_EXTERNE_WURZELN=%s\n' "$EXTERNAL_ROOT_BASE"
fi
((APPLY)) || exit 0

STAMP=$(date '+%Y%m%d_%H%M%S')
ROLLBACK_ROOT=$SERVER_DIR/_restore-rollback
mkdir -p -- "$ROLLBACK_ROOT"
ROLLBACK=$ROLLBACK_ROOT/$STAMP-$$
mkdir -- "$ROLLBACK"
JOURNAL=$ROLLBACK/ROLLBACK-JOURNAL.txt
ROLLBACK_REFERENCES=$ROLLBACK/ROLLBACK-ZIELE.txt
printf '%s BEGIN snapshot=%s data=%s db=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$SNAPSHOT" "$DATA_TARGET" "$DB_TARGET" > "$JOURNAL"

# Die eigentlichen Alt-/Fehlstände liegen nie im zentralen Journalordner,
# sondern als verborgene Geschwister ihrer jeweiligen Ziele. Dadurch bleibt
# jedes spätere Rename innerhalb genau eines Dateisystems.
DATA_ROLLBACK=$DATA_PARENT/.betreuungsbuero-restore-rollback-$STAMP-$$-daten
if ((DB_INSIDE_DATA)); then
  DB_ROLLBACK=$DATA_ROLLBACK
else
  DB_ROLLBACK=$DB_PARENT/.betreuungsbuero-restore-rollback-$STAMP-$$-db
fi
if [[ -n $EXTERNAL_ROOT_BASE ]]; then
  EXTERNAL_ROLLBACK=$EXTERNAL_PARENT/.betreuungsbuero-restore-rollback-$STAMP-$$-extern
fi
if ((RESTORE_RUNTIME_ARTIFACTS)); then
  RUNTIME_ROLLBACK=$TEMPLATE_PARENT/.betreuungsbuero-restore-rollback-$STAMP-$$-templates
  EXTENSION_ROLLBACK=$EXTENSION_PARENT/.betreuungsbuero-restore-rollback-$STAMP-$$-extensions
  APP_ROLLBACK=$OUTPUTS_PARENT/.betreuungsbuero-restore-rollback-$STAMP-$$-app
fi
{
  printf 'FORMAT=Betreuungsbuero-Restore-Zielverweise/1\n'
  printf 'JOURNAL=%s\n' "$JOURNAL"
  printf 'DATEN_ZIEL=%s\nDATEN_ROLLBACK=%s\n' "$DATA_TARGET" "$DATA_ROLLBACK"
  printf 'DB_ZIEL=%s\nDB_ROLLBACK=%s\nDB_IM_DATENBAUM=%d\n' \
    "$DB_TARGET" "$DB_ROLLBACK" "$DB_INSIDE_DATA"
  if [[ -n $EXTERNAL_ROLLBACK ]]; then
    printf 'EXTERN_ZIEL=%s\nEXTERN_ROLLBACK=%s\n' "$EXTERNAL_ROOT_BASE" "$EXTERNAL_ROLLBACK"
  fi
  if [[ -n $RUNTIME_ROLLBACK ]]; then
    printf 'VORLAGEN_ZIEL=%s\nVORLAGEN_ROLLBACK=%s\n' "$TEMPLATE_TARGET" "$RUNTIME_ROLLBACK"
    printf 'ERWEITERUNGEN_ZIEL=%s\nERWEITERUNGEN_ROLLBACK=%s\n' \
      "$EXTENSION_TARGET" "$EXTENSION_ROLLBACK"
    printf 'APP_ZIEL=%s\nAPP_ROLLBACK=%s\n' "$OUTPUTS_TARGET" "$APP_ROLLBACK"
  fi
} > "$ROLLBACK_REFERENCES"

STAGE=$(mktemp -d "$DATA_PARENT/.betreuungsbuero-restore-stage.XXXXXXXX")
# Nicht den Baum pauschal kopieren: Es werden ausschließlich zuvor
# manifestierte reguläre Dateien aus server-data übernommen. Selbst eine
# zwischen Prüfung und Kopie eingeschleuste Datei kann so nicht aktiv werden.
while IFS=$'\t' read -r expected_hash expected_size encoded; do
  rel=$(printf '%s' "$encoded" | base64 "$B64") || die "Ungültiger Base64-Pfad beim Kopieren."
  case "$rel" in
    inhalt/server-data/*)
      data_rel=${rel#inhalt/server-data/}
      [[ -n $data_rel ]] || continue
      mkdir -p -- "$(dirname -- "$STAGE/$data_rel")"
      cp -p -- "$SNAPSHOT/$rel" "$STAGE/$data_rel"
      ;;
  esac
done < "$MANIFEST_SAFE"

# Eigenständige Dokumentwurzeln werden in einem zweiten, ebenfalls
# manifestgebundenen Staging-Baum aufgebaut. Ein alter absoluter Quellpfad wird
# dabei niemals als Ziel verwendet.
if ((EXTERNAL_PHYSICAL)); then
  EXTERNAL_STAGE=$(mktemp -d "$EXTERNAL_PARENT/.betreuungsbuero-external-restore-stage.XXXXXXXX")
  EXTERNAL_EXPECTED=0
  # Auch vollständig leere, aber konfigurierte Wurzeln müssen nach dem Restore
  # als echte Ordner existieren. Die Verzeichnisnamen stammen ausschließlich
  # aus der manifestierten Wurzelzuordnung, nicht aus unmanifestierten
  # Verzeichniseinträgen des Snapshots.
  while IFS=$'\t' read -r _root_art _root_id root_snapshot_b64 _root_target_b64; do
    root_rel=$(printf '%s' "$root_snapshot_b64" | base64 "$B64") ||
      die "Eine externe Restore-Wurzel ist nicht dekodierbar."
    case "$root_rel" in
      inhalt/externe-dokumentwurzeln/*)
        external_rel=${root_rel#inhalt/externe-dokumentwurzeln/}
        [[ -n $external_rel ]] || die "Eine externe Restore-Wurzel ist leer."
        mkdir -p -- "$EXTERNAL_STAGE/$external_rel"
        ;;
    esac
  done < "$ROOT_MAP"
  while IFS=$'\t' read -r expected_hash expected_size encoded; do
    rel=$(printf '%s' "$encoded" | base64 "$B64") ||
      die "Ungültiger Base64-Pfad beim Aufbau externer Wurzeln."
    case "$rel" in
      inhalt/externe-dokumentwurzeln/*)
        external_rel=${rel#inhalt/externe-dokumentwurzeln/}
        [[ -n $external_rel ]] || continue
        mkdir -p -- "$(dirname -- "$EXTERNAL_STAGE/$external_rel")"
        cp -p -- "$SNAPSHOT/$rel" "$EXTERNAL_STAGE/$external_rel"
        [[ $(wc -c < "$EXTERNAL_STAGE/$external_rel" | tr -d ' ') == "$expected_size" ]] ||
          die "Dateigröße einer externen Restore-Datei stimmt nicht: $external_rel"
        [[ $(sha_file "$EXTERNAL_STAGE/$external_rel" | tr 'A-F' 'a-f') == \
           $(printf '%s' "$expected_hash" | tr 'A-F' 'a-f') ]] ||
          die "Prüfsumme einer externen Restore-Datei stimmt nicht: $external_rel"
        EXTERNAL_EXPECTED=$((EXTERNAL_EXPECTED + 1))
        ;;
    esac
  done < "$MANIFEST_SAFE"
  while IFS= read -r -d '' special; do
    die "Die externe Restore-Stage enthält einen Link oder eine Spezialdatei."
  done < <(find "$EXTERNAL_STAGE" ! -type f ! -type d -print0)
  EXTERNAL_FILES=$(find "$EXTERNAL_STAGE" -type f | wc -l | tr -d ' ')
  [[ $EXTERNAL_FILES == "$EXTERNAL_EXPECTED" ]] ||
    die "Dateimenge der externen Restore-Stage stimmt nicht mit dem Manifest überein."
fi

if ((RESTORE_RUNTIME_ARTIFACTS)); then
  EXTENSION_STAGE=$(mktemp -d "$EXTENSION_PARENT/.betreuungsbuero-extension-restore-stage.XXXXXXXX")
  TEMPLATE_STAGE=$(mktemp -d "$TEMPLATE_PARENT/.betreuungsbuero-template-restore-stage.XXXXXXXX")
  APP_STAGE=$(mktemp -d "$OUTPUTS_PARENT/.betreuungsbuero-app-restore-stage.XXXXXXXX")
  EXTENSION_EXPECTED=0
  TEMPLATE_EXPECTED=0
  APP_EXPECTED=0
  while IFS=$'\t' read -r expected_hash expected_size encoded; do
    rel=$(printf '%s' "$encoded" | base64 "$B64") ||
      die "Ungültiger Base64-Pfad beim Aufbau der Betriebsartefakte."
    runtime_stage=
    runtime_rel=
    case "$rel" in
      betrieb/browser-erweiterungen/*)
        runtime_stage=$EXTENSION_STAGE
        runtime_rel=${rel#betrieb/browser-erweiterungen/}
        EXTENSION_EXPECTED=$((EXTENSION_EXPECTED + 1))
        ;;
      betrieb/server-ressourcen/templates/*)
        runtime_stage=$TEMPLATE_STAGE
        runtime_rel=${rel#betrieb/server-ressourcen/templates/}
        TEMPLATE_EXPECTED=$((TEMPLATE_EXPECTED + 1))
        ;;
      betrieb/anwendung/*)
        runtime_stage=$APP_STAGE
        runtime_rel=${rel#betrieb/anwendung/}
        APP_EXPECTED=$((APP_EXPECTED + 1))
        ;;
      *) continue ;;
    esac
    [[ -n $runtime_rel ]] || die "Leerer Betriebsartefaktpfad."
    mkdir -p -- "$(dirname -- "$runtime_stage/$runtime_rel")"
    cp -p -- "$SNAPSHOT/$rel" "$runtime_stage/$runtime_rel"
    [[ $(wc -c < "$runtime_stage/$runtime_rel" | tr -d ' ') == "$expected_size" ]] ||
      die "Dateigröße eines Betriebsartefakts stimmt nicht: $runtime_rel"
    [[ $(sha_file "$runtime_stage/$runtime_rel" | tr 'A-F' 'a-f') == \
       $(printf '%s' "$expected_hash" | tr 'A-F' 'a-f') ]] ||
      die "Prüfsumme eines Betriebsartefakts stimmt nicht: $runtime_rel"
  done < "$MANIFEST_SAFE"
  [[ $TEMPLATE_EXPECTED -gt 0 ]] || die "Der Snapshot enthält keine wiederherstellbaren Servervorlagen."
  [[ $APP_EXPECTED -gt 0 ]] || die "Der Snapshot enthält keine wiederherstellbare HTML-App."
  [[ $(find "$EXTENSION_STAGE" -type f | wc -l | tr -d ' ') == "$EXTENSION_EXPECTED" ]] ||
    die "Dateimenge der Browser-Erweiterungs-Stage stimmt nicht."
  [[ $(find "$APP_STAGE" -type f | wc -l | tr -d ' ') == "$APP_EXPECTED" ]] ||
    die "Dateimenge der App-Stage stimmt nicht."
  [[ $(find "$TEMPLATE_STAGE" -type f | wc -l | tr -d ' ') == "$TEMPLATE_EXPECTED" ]] ||
    die "Dateimenge der Vorlagen-Stage stimmt nicht."
  while IFS= read -r -d '' special; do
    die "Eine Betriebsartefakt-Stage enthält einen Link oder eine Spezialdatei."
  done < <(find "$EXTENSION_STAGE" "$TEMPLATE_STAGE" "$APP_STAGE" ! -type f ! -type d -print0)
fi

# Zweite Prüfung auf der tatsächlich gebauten Stage schließt den Zeitraum
# zwischen Quellprüfung und Kopie ein. Ein ausgetauschter Pfad, Link oder
# während cp veränderter Inhalt kann dadurch nicht aktiviert werden.
STAGE_EXPECTED=0
while IFS=$'\t' read -r expected_hash expected_size encoded; do
  rel=$(printf '%s' "$encoded" | base64 "$B64") || die "Ungültiger Base64-Pfad bei der Stage-Prüfung."
  case "$rel" in
    inhalt/server-data/*)
      data_rel=${rel#inhalt/server-data/}
      [[ -n $data_rel ]] || continue
      staged=$STAGE/$data_rel
      [[ -f $staged && ! -L $staged ]] || die "Manifestierte Stage-Datei fehlt oder ist ein Link: $data_rel"
      [[ $(wc -c < "$staged" | tr -d ' ') == "$expected_size" ]] ||
        die "Stage-Dateigröße stimmt nicht: $data_rel"
      [[ $(sha_file "$staged" | tr 'A-F' 'a-f') == $(printf '%s' "$expected_hash" | tr 'A-F' 'a-f') ]] ||
        die "Stage-Dateiprüfsumme stimmt nicht: $data_rel"
      STAGE_EXPECTED=$((STAGE_EXPECTED + 1))
      ;;
  esac
done < "$MANIFEST_SAFE"
while IFS= read -r -d '' special; do
  die "Die Restore-Stage enthält einen Link oder eine Spezialdatei: ${special#"$STAGE/"}"
done < <(find "$STAGE" ! -type f ! -type d -print0)
STAGE_FILES=$(find "$STAGE" -type f | wc -l | tr -d ' ')
[[ $STAGE_FILES == "$STAGE_EXPECTED" ]] ||
  die "Dateimenge der Restore-Stage stimmt nicht mit dem Manifest überein."
case "$DB_TARGET/" in
  "$DATA_TARGET/"*)
    DB_REL=${DB_TARGET#"$DATA_TARGET/"}
    mkdir -p -- "$(dirname -- "$STAGE/$DB_REL")"
    cp -p -- "$DB_SOURCE" "$STAGE/$DB_REL"
    RESTORED_DB_STAGE=$STAGE/$DB_REL
    DB_INSIDE_DATA=1
    ;;
  *)
    DB_INSIDE_DATA=0
    DB_STAGE=$DB_PARENT/.betreuungsbuero-restore-db-$STAMP-$$
    cp -p -- "$DB_SOURCE" "$DB_STAGE"
    RESTORED_DB_STAGE=$DB_STAGE
    ;;
esac

[[ $(wc -c < "$RESTORED_DB_STAGE" | tr -d ' ') == "$DB_MANIFEST_SIZE" ]] ||
  die "Die kopierte Restore-DB stimmt in der Größe nicht mehr mit dem Manifest überein."
[[ $(sha_file "$RESTORED_DB_STAGE" | tr 'A-F' 'a-f') == "$DB_MANIFEST_SHA" ]] ||
  die "Die kopierte Restore-DB stimmt nicht mehr mit dem Manifest überein."

if ((EXTERNAL_MAPPINGS)); then
  CONFIG_ROWS=$(sqlite3 -batch -noheader "$RESTORED_DB_STAGE" \
    "SELECT count(*) FROM office_json WHERE key='documents_config';" 2>/dev/null) ||
    die "Die Dokumentwurzel-Konfiguration kann in der Restore-DB nicht geprüft werden."
  [[ $CONFIG_ROWS == 1 ]] ||
    die "Die Restore-DB enthält keine eindeutige documents_config-Zeile für die Wurzelzuordnung."
  CONFIG_HEX=$(sqlite3 -batch -noheader "$RESTORED_DB_STAGE" \
    "SELECT hex(data_json) FROM office_json WHERE key='documents_config';") ||
    die "Die Dokumentwurzel-Konfiguration kann nicht gelesen werden."
  NEW_CONFIG_HEX=$(node - "$ROOT_MAP" "$CONFIG_HEX" <<'NODE'
const fs = require('fs');
const [mapFile, inputHex] = process.argv.slice(2);
let config;
try {
  config = JSON.parse(Buffer.from(inputHex, 'hex').toString('utf8') || '{}');
} catch (_error) {
  throw new Error('documents_config ist kein gültiges JSON.');
}
if (!config || Array.isArray(config) || typeof config !== 'object') {
  throw new Error('documents_config ist kein JSON-Objekt.');
}
const assigned = new Map();
for (const line of fs.readFileSync(mapFile, 'utf8').split(/\r?\n/)) {
  if (!line) continue;
  const fields = line.split('\t');
  if (fields.length !== 4) throw new Error('Interne Wurzelzuordnung ist ungültig.');
  const [kind, encodedId, _source, targetB64] = fields;
  const target = Buffer.from(targetB64, 'base64').toString('utf8');
  if (!target.startsWith('/') || /[\0\r\n\t]/.test(target)) {
    throw new Error('Eine wiederhergestellte Dokumentwurzel besitzt kein sicheres absolutes Ziel.');
  }
  let key;
  if (kind === 'STORAGE') {
    key = 'storageRoot';
    config.storageRoot = target;
  } else if (kind === 'BASE') {
    key = 'baseDir';
    config.baseDir = target;
  } else if (kind === 'CASE') {
    if (!/^(?:[0-9a-f]{2})+$/i.test(encodedId)) {
      throw new Error('Eine Fallwurzelkennung ist nicht gültiges Hex.');
    }
    const caseId = Buffer.from(encodedId, 'hex').toString('utf8');
    if (!caseId || /[\0\r\n\t]/.test(caseId)) throw new Error('Eine Fallwurzelkennung ist ungültig.');
    if (!config.caseDirs || Array.isArray(config.caseDirs) || typeof config.caseDirs !== 'object') {
      config.caseDirs = {};
    }
    key = `case:${caseId}`;
    config.caseDirs[caseId] = target;
  } else {
    throw new Error('Unbekannte Wurzelart.');
  }
  if (assigned.has(key) && assigned.get(key) !== target) {
    throw new Error(`Wurzel ${key} besitzt mehrere verschiedene Ziele.`);
  }
  assigned.set(key, target);
}
process.stdout.write(Buffer.from(JSON.stringify(config), 'utf8').toString('hex'));
NODE
  ) || die "Die Dokumentwurzel-Konfiguration konnte nicht auf die Restore-Ziele umgeschrieben werden."
  [[ $NEW_CONFIG_HEX =~ ^[0-9a-fA-F]+$ ]] ||
    die "Die umgeschriebene Dokumentwurzel-Konfiguration ist ungültig."
  CONFIG_UPDATED=$(sqlite3 -batch -noheader "$RESTORED_DB_STAGE" \
    "UPDATE office_json SET data_json=CAST(X'$NEW_CONFIG_HEX' AS TEXT) WHERE key='documents_config'; SELECT changes();") ||
    die "Die neue Dokumentwurzel-Konfiguration konnte nicht in die Restore-DB geschrieben werden."
  [[ $CONFIG_UPDATED == 1 ]] || die "Die Dokumentwurzel-Konfiguration wurde nicht eindeutig aktualisiert."
fi

# Ein technisch intakter Restore ohne erreichbaren Online-Administrator wäre
# trotzdem nicht betreibbar. Dieser Zustand wird deshalb vor dem ersten
# Austausch und nicht erst beim anschließenden Anmeldeversuch abgelehnt.
USERS_SCHEMA_MISSING=$(sqlite3 -batch -noheader "$RESTORED_DB_STAGE" "
  WITH required(name) AS (
    VALUES
      ('id'),
      ('username'),
      ('password_hash'),
      ('display_name'),
      ('allow_local'),
      ('allow_online'),
      ('is_admin'),
      ('allow_case_management'),
      ('created_at'),
      ('active')
  )
  SELECT coalesce(group_concat(required.name, ', '), '')
  FROM required
  WHERE NOT EXISTS (
    SELECT 1
    FROM pragma_table_info('users') AS actual
    WHERE actual.name = required.name
  );
" 2>/dev/null) || die "Die Benutzerstruktur der Restore-DB kann nicht geprüft werden."
[[ -z $USERS_SCHEMA_MISSING ]] ||
  die "Die Restore-DB enthält keine vollständige Benutzerstruktur. Fehlende Spalten: $USERS_SCHEMA_MISSING."
ONLINE_ADMINS=$(sqlite3 -batch -noheader "$RESTORED_DB_STAGE" "
  SELECT count(*) FROM users
  WHERE active != 0 AND is_admin != 0 AND allow_online != 0
    AND length(trim(coalesce(username,''))) > 0
    AND length(coalesce(password_hash,'')) = 60
    AND substr(password_hash,1,4) IN ('\$2a\$','\$2b\$')
    AND substr(password_hash,5,2) GLOB '[0-9][0-9]'
    AND CAST(substr(password_hash,5,2) AS INTEGER) BETWEEN 4 AND 31
    AND substr(password_hash,7,1) = '\$'
    AND substr(password_hash,8,53) NOT GLOB '*[^./A-Za-z0-9]*';
" 2>/dev/null) || die "Die Online-Administratoren der Restore-DB können nicht geprüft werden."
[[ $ONLINE_ADMINS =~ ^[0-9]+$ && $ONLINE_ADMINS -gt 0 ]] ||
  die "Die Restore-DB enthält keinen aktiven, anmeldbaren Online-Administrator."
[[ $(sqlite3 -batch -noheader "$RESTORED_DB_STAGE" 'PRAGMA integrity_check;') == ok ]] ||
  die "Die vorbereitete Restore-DB ist nach der Zielanpassung nicht integer."
[[ -z $(sqlite3 -batch -noheader "$RESTORED_DB_STAGE" 'PRAGMA foreign_key_check;') ]] ||
  die "Die vorbereitete Restore-DB hat nach der Zielanpassung Fremdschlüsselverletzungen."

{
  printf 'Betreuungsbuero-Recovery-Quarantaene/1\n'
  printf 'RESTORED_AT=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'SNAPSHOT=%s\n' "${SNAPSHOT##*/}"
  printf 'BACKGROUND_JOBS=DISABLED_UNTIL_ADMIN_RELEASE\n'
} > "$STAGE/.recovery-quarantine"

# Dieser Marker liegt im kanonischen Parent des Datenziels und damit außerhalb
# des gleich auszutauschenden Baums. Ein SIGKILL oder Stromausfall in irgendeinem
# folgenden Rename-Fenster wird deshalb beim nächsten Serverstart erkannt.
DATA_TARGET_SHA=$(printf '%s' "$DATA_TARGET" | sha_text)
fortschrittsmarker_schreiben \
  "$RESTORE_PROGRESS_MARKER" "${SNAPSHOT##*/}" "$DATA_TARGET_SHA" ||
  die "Der Restore-Fortschrittsmarker konnte nicht dauerhaft angelegt werden."
if ! sync "$RESTORE_PROGRESS_MARKER" "$DATA_PARENT" 2>/dev/null; then
  sync 2>/dev/null ||
    die "Der Restore-Fortschrittsmarker konnte nicht dauerhaft geschrieben werden."
fi
RESTORE_PROGRESS_ACTIVE=1
printf '%s MARK restore-in-progress -> %s\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RESTORE_PROGRESS_MARKER" >> "$JOURNAL"

mkdir -- "$DATA_ROLLBACK"
DATA_OLD=$DATA_ROLLBACK/alter-datenstand
DATA_FAILED=$DATA_ROLLBACK/fehlgeschlagen-neue-daten
if ((DB_INSIDE_DATA == 0)); then
  mkdir -- "$DB_ROLLBACK"
  DB_OLD=$DB_ROLLBACK/alte-datenbank.sqlite3
  DB_FAILED=$DB_ROLLBACK/fehlgeschlagen-neue-db.sqlite3
fi
if [[ -n $EXTERNAL_ROLLBACK ]]; then
  mkdir -- "$EXTERNAL_ROLLBACK"
  EXTERNAL_OLD=$EXTERNAL_ROLLBACK/alte-externe-dokumentwurzeln
  EXTERNAL_FAILED=$EXTERNAL_ROLLBACK/fehlgeschlagen-neue-externe-wurzeln
fi
if [[ -n $RUNTIME_ROLLBACK ]]; then
  mkdir -- "$RUNTIME_ROLLBACK" "$EXTENSION_ROLLBACK" "$APP_ROLLBACK"
  TEMPLATE_OLD=$RUNTIME_ROLLBACK/alte-servervorlagen
  TEMPLATE_FAILED=$RUNTIME_ROLLBACK/fehlgeschlagen-neue-vorlagen
  EXTENSION_OLD=$EXTENSION_ROLLBACK/alte-browser-erweiterungen
  EXTENSION_FAILED=$EXTENSION_ROLLBACK/fehlgeschlagen-neue-browser-erweiterungen
  APP_OLD=$APP_ROLLBACK/alte-app-ausgabe
  APP_FAILED=$APP_ROLLBACK/fehlgeschlagen-neue-app-ausgabe
fi

# 1. Fachlicher Datenbaum und die dazugehörige SQLite-Datenbank werden zuerst
# aktiviert. Erst ein nachfolgend erfolgreicher DB-Check erlaubt weitere Ziele.
mountpoint_ausschliessen "$DATA_TARGET" "Das Datenziel"
if [[ -e $DATA_TARGET ]]; then
  [[ -d $DATA_TARGET && ! -L $DATA_TARGET ]] ||
    die "Das Datenziel wurde vor dem atomaren Tausch ausgetauscht."
  mv -- "$DATA_TARGET" "$DATA_OLD"
  printf '%s MOVE old-data -> %s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$DATA_OLD" >> "$JOURNAL"
fi
DATA_NEW_ACTIVE=1
mv -- "$STAGE" "$DATA_TARGET"
STAGE=
printf '%s ACTIVATE new-data -> %s\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$DATA_TARGET" >> "$JOURNAL"

if ((DB_INSIDE_DATA == 0)); then
  mountpoint_ausschliessen "$DB_TARGET" "Das Datenbankziel"
  if [[ -e $DB_TARGET ]]; then
    [[ -f $DB_TARGET && ! -L $DB_TARGET ]] ||
      die "Das Datenbankziel wurde vor dem atomaren Tausch ausgetauscht."
    mv -- "$DB_TARGET" "$DB_OLD"
    printf '%s MOVE old-db -> %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$DB_OLD" >> "$JOURNAL"
  fi
  DB_NEW_ACTIVE=1
  mv -- "$DB_STAGE" "$DB_TARGET"
  DB_STAGE=
  printf '%s ACTIVATE new-db -> %s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$DB_TARGET" >> "$JOURNAL"
fi

[[ $(sqlite3 -batch -noheader "$DB_TARGET" 'PRAGMA integrity_check;') == ok ]] ||
  { printf 'Nachprüfung der aktivierten Datenbank fehlgeschlagen.\n' >&2; exit 70; }
[[ -z $(sqlite3 -batch -noheader "$DB_TARGET" 'PRAGMA foreign_key_check;') ]] ||
  { printf 'Fremdschlüssel-Nachprüfung der aktivierten Datenbank fehlgeschlagen.\n' >&2; exit 70; }
printf '%s VERIFY active-db=ok\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$JOURNAL"

# 2. Erst nach dem geprüften fachlichen Kern folgen externe Dokumentwurzeln.
if ((EXTERNAL_PHYSICAL)); then
  mountpoint_ausschliessen "$EXTERNAL_ROOT_BASE" \
    "Das Ziel für externe Dokumentwurzeln"
  if [[ -e $EXTERNAL_ROOT_BASE ]]; then
    [[ -d $EXTERNAL_ROOT_BASE && ! -L $EXTERNAL_ROOT_BASE ]] ||
      die "Das Ziel für externe Dokumentwurzeln wurde vor dem atomaren Tausch ausgetauscht."
    mv -- "$EXTERNAL_ROOT_BASE" "$EXTERNAL_OLD"
    printf '%s MOVE old-external-roots -> %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$EXTERNAL_OLD" >> "$JOURNAL"
  fi
  EXTERNAL_NEW_ACTIVE=1
  mv -- "$EXTERNAL_STAGE" "$EXTERNAL_ROOT_BASE"
  EXTERNAL_STAGE=
  printf '%s ACTIVATE external-roots -> %s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$EXTERNAL_ROOT_BASE" >> "$JOURNAL"
fi

# 3. Laufzeitartefakte kommen zuletzt. Ein Crash kann dadurch niemals neue
# Templates/App mit einer noch alten Datenbank sichtbar machen.
if ((RESTORE_RUNTIME_ARTIFACTS)); then
  mountpoint_ausschliessen "$TEMPLATE_TARGET" "Das Ziel für Servervorlagen"
  if [[ -e $TEMPLATE_TARGET ]]; then
    [[ -d $TEMPLATE_TARGET && ! -L $TEMPLATE_TARGET ]] ||
      die "Das Ziel für Servervorlagen wurde vor dem atomaren Tausch ausgetauscht."
    mv -- "$TEMPLATE_TARGET" "$TEMPLATE_OLD"
    printf '%s MOVE old-server-templates -> %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$TEMPLATE_OLD" >> "$JOURNAL"
  fi
  TEMPLATE_NEW_ACTIVE=1
  mv -- "$TEMPLATE_STAGE" "$TEMPLATE_TARGET"
  TEMPLATE_STAGE=
  printf '%s ACTIVATE server-templates -> %s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$TEMPLATE_TARGET" >> "$JOURNAL"

  mountpoint_ausschliessen "$EXTENSION_TARGET" \
    "Das Ziel für Browser-Erweiterungen"
  if [[ -e $EXTENSION_TARGET ]]; then
    [[ -d $EXTENSION_TARGET && ! -L $EXTENSION_TARGET ]] ||
      die "Das Ziel für Browser-Erweiterungen wurde vor dem atomaren Tausch ausgetauscht."
    mv -- "$EXTENSION_TARGET" "$EXTENSION_OLD"
    printf '%s MOVE old-browser-extensions -> %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$EXTENSION_OLD" >> "$JOURNAL"
  fi
  EXTENSION_NEW_ACTIVE=1
  mv -- "$EXTENSION_STAGE" "$EXTENSION_TARGET"
  EXTENSION_STAGE=
  printf '%s ACTIVATE browser-extensions -> %s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$EXTENSION_TARGET" >> "$JOURNAL"

  mountpoint_ausschliessen "$OUTPUTS_TARGET" "Das App-Ausgabeziel"
  if [[ -e $OUTPUTS_TARGET ]]; then
    [[ -d $OUTPUTS_TARGET && ! -L $OUTPUTS_TARGET ]] ||
      die "Das App-Ausgabeziel wurde vor dem atomaren Tausch ausgetauscht."
    mv -- "$OUTPUTS_TARGET" "$APP_OLD"
    printf '%s MOVE old-app-output -> %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$APP_OLD" >> "$JOURNAL"
  fi
  APP_NEW_ACTIVE=1
  mv -- "$APP_STAGE" "$OUTPUTS_TARGET"
  APP_STAGE=
  printf '%s ACTIVATE app-output -> %s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$OUTPUTS_TARGET" >> "$JOURNAL"
fi

# Der Commitpunkt liegt erst hinter einem erfolgreichen Dateisystem-Flush aller
# Zielrenames. Danach bleibt selbst bei einem Markerfehler mindestens die bereits
# dauerhaft aktivierte .recovery-quarantine im neuen Datenbaum.
sync 2>/dev/null || {
  printf 'Die aktivierten Restore-Ziele konnten nicht dauerhaft synchronisiert werden.\n' >&2
  exit 74
}
RESTORE_COMMITTED=1
DATA_NEW_ACTIVE=0
DB_NEW_ACTIVE=0
EXTERNAL_NEW_ACTIVE=0
EXTENSION_NEW_ACTIVE=0
TEMPLATE_NEW_ACTIVE=0
APP_NEW_ACTIVE=0
if ! fortschrittsmarker_entfernen; then
  printf '%s COMMIT vollständig, Fortschrittsmarker konnte nicht entfernt werden\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$JOURNAL"
  printf 'Der neue Stand ist vollständig und quarantänisiert, aber der Restore-Fortschrittsmarker bleibt zur sicheren Prüfung liegen.\n' >&2
  exit 74
fi
printf '%s COMPLETE quarantine=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$DATA_TARGET/.recovery-quarantine" >> "$JOURNAL"
printf 'STATUS=WIEDERHERGESTELLT_QUARANTAENE\nROLLBACK=%s\nJOURNAL=%s\n' "$ROLLBACK" "$JOURNAL"
printf 'ROLLBACK_DATEN=%s\nROLLBACK_DB=%s\n' "$DATA_ROLLBACK" "$DB_ROLLBACK"
if ((EXTERNAL_PHYSICAL)); then
  printf 'ROLLBACK_EXTERN=%s\n' "$EXTERNAL_ROLLBACK"
  printf 'EXTERNE_WURZELN=WIEDERHERGESTELLT ZIEL=%s\n' "$EXTERNAL_ROOT_BASE"
fi
if ((RESTORE_RUNTIME_ARTIFACTS)); then
  printf 'ROLLBACK_VORLAGEN=%s\nROLLBACK_ERWEITERUNGEN=%s\nROLLBACK_APP=%s\n' \
    "$RUNTIME_ROLLBACK" "$EXTENSION_ROLLBACK" "$APP_ROLLBACK"
  printf 'SERVERVORLAGEN=WIEDERHERGESTELLT ZIEL=%s\n' "$TEMPLATE_TARGET"
  printf 'BROWSER_ERWEITERUNGEN=WIEDERHERGESTELLT ZIEL=%s\n' "$EXTENSION_TARGET"
  printf 'HTML_APP=WIEDERHERGESTELLT ZIEL=%s\n' "$OUTPUTS_TARGET"
fi
exit 0
