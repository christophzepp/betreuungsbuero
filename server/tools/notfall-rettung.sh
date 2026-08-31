#!/usr/bin/env bash
#
# Rekonstruiert aus einer mit gesamt-backup.sh erzeugten Sicherung eine ohne
# Anwendung lesbare Ablage. Das Quell-Backup wird nie veraendert.

set -euo pipefail
IFS=$'\n\t'
umask 077

PROGRAMM=${0##*/}
SNAPSHOT=
AUSGABE=
PRUEFEN=ja
STAGE=
MANIFEST_LIST=
FEHLER=0
KOPIERT=0
ROH_KOPIERT=0
KOLLISIONEN=0

hilfe() {
  cat <<'EOF'
Aufruf:
  notfall-rettung.sh --snapshot GESAMTSICHERUNG --output ZIELORDNER
                       [--skip-verify]

Die Pruefsummen werden vor der Rettung vollstaendig kontrolliert. Nur wenn das
Manifest selbst beschaedigt ist und trotzdem gerettet werden soll, darf
--skip-verify verwendet werden. Das Ergebnis wird dann als unvollstaendig markiert.

Rueckgabecodes:
  0  Rettung vollstaendig
  2  Rettung angelegt, aber mit sichtbaren Befunden
  >2 Rettung abgebrochen
EOF
}

abbruch() {
  printf '%s: %s\n' "$PROGRAMM" "$*" >&2
  exit 64
}

aufräumen() {
  rc=$?
  if [[ -n ${STAGE:-} && -d $STAGE ]]; then
    rm -rf -- "$STAGE"
  fi
  if [[ -n ${MANIFEST_LIST:-} && -f $MANIFEST_LIST ]]; then
    rm -f -- "$MANIFEST_LIST"
  fi
  exit "$rc"
}
trap aufräumen EXIT HUP INT TERM

while (($#)); do
  case "$1" in
    --snapshot)
      (($# >= 2)) || abbruch "--snapshot braucht einen Wert."
      SNAPSHOT=$2
      shift 2
      ;;
    --output)
      (($# >= 2)) || abbruch "--output braucht einen Wert."
      AUSGABE=$2
      shift 2
      ;;
    --skip-verify)
      PRUEFEN=nein
      shift
      ;;
    --help|-h)
      hilfe
      exit 0
      ;;
    *)
      abbruch "Unbekanntes Argument: $1"
      ;;
  esac
done

[[ -n $SNAPSHOT ]] || abbruch "--snapshot fehlt."
[[ -n $AUSGABE ]] || abbruch "--output fehlt."
[[ -d $SNAPSHOT ]] || abbruch "Snapshot fehlt: $SNAPSHOT"

for werkzeug in sqlite3 find wc od tr grep sed awk sort uniq date mktemp mv cp base64; do
  command -v "$werkzeug" >/dev/null 2>&1 || abbruch "Benoetigtes Werkzeug fehlt: $werkzeug"
done
if command -v shasum >/dev/null 2>&1; then
  SHA_ART=shasum
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_ART=sha256sum
else
  abbruch "Weder shasum noch sha256sum ist vorhanden."
fi

if printf 'Zg==' | base64 -d >/dev/null 2>&1; then
  B64_FLAG=-d
elif printf 'Zg==' | base64 -D >/dev/null 2>&1; then
  B64_FLAG=-D
else
  abbruch "base64 kann nicht zum Dekodieren aufgerufen werden."
fi

kanon_ordner() {
  (CDPATH= cd -- "$1" && pwd -P)
}

SNAPSHOT=$(kanon_ordner "$SNAPSHOT")
AUSGABE_ELTERN=$(dirname -- "$AUSGABE")
AUSGABE_NAME=${AUSGABE##*/}
[[ -n $AUSGABE_NAME && $AUSGABE_NAME != . && $AUSGABE_NAME != .. ]] ||
  abbruch "Ungueltiger Ausgabeordner."
mkdir -p -- "$AUSGABE_ELTERN"
AUSGABE_ELTERN=$(kanon_ordner "$AUSGABE_ELTERN")
AUSGABE=$AUSGABE_ELTERN/$AUSGABE_NAME
[[ ! -e $AUSGABE ]] || abbruch "Der Ausgabeordner existiert bereits: $AUSGABE"
case "$AUSGABE/" in
  "$SNAPSHOT/"*) abbruch "Der Ausgabeordner darf nicht innerhalb des Snapshots liegen." ;;
esac

sha_datei() {
  if [[ $SHA_ART == shasum ]]; then
    shasum -a 256 -- "$1" | awk '{print $1}'
  else
    sha256sum -- "$1" | awk '{print $1}'
  fi
}

b64() {
  printf '%s' "$1" | base64 | tr -d '\r\n'
}

hex() {
  printf '%s' "$1" | LC_ALL=C od -An -tx1 | tr -d ' \n'
}

b64_nach_variable() {
  local __ziel=$1 __wert=$2 __ausgabe
  __ausgabe=$(printf '%s' "$__wert" | base64 "$B64_FLAG"; printf /) || return 1
  __ausgabe=${__ausgabe%/}
  printf -v "$__ziel" '%s' "$__ausgabe"
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

enthaelt_steuerzeichen() {
  case "$1" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 0 ;;
    *) return 1 ;;
  esac
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

manifest_pfad_sicher() {
  local p=$1
  [[ -n $p && $p != /* && $p != *'//'* ]] || return 1
  case "/$p/" in
    */../*|*/./*) return 1 ;;
  esac
  return 0
}

if [[ $PRUEFEN == ja ]]; then
  [[ -f $SNAPSHOT/MANIFEST.tsv && ! -L $SNAPSHOT/MANIFEST.tsv &&
     -f $SNAPSHOT/MANIFEST.tsv.sha256 && ! -L $SNAPSHOT/MANIFEST.tsv.sha256 ]] ||
    abbruch "Manifest oder Manifest-Pruefsumme fehlt."
  read -r MANIFEST_SOLL < "$SNAPSHOT/MANIFEST.tsv.sha256" || true
  MANIFEST_IST=$(sha_datei "$SNAPSHOT/MANIFEST.tsv")
  MANIFEST_SOLL=$(printf '%s' "$MANIFEST_SOLL" | tr 'A-F' 'a-f')
  MANIFEST_IST=$(printf '%s' "$MANIFEST_IST" | tr 'A-F' 'a-f')
  [[ $MANIFEST_SOLL =~ ^[0-9a-f]{64}$ && $MANIFEST_IST == "$MANIFEST_SOLL" ]] ||
    abbruch "MANIFEST.tsv ist beschaedigt."

  MANIFEST_LIST=$(mktemp "${TMPDIR:-/tmp}/betreuungsbuero-rettung-manifest.XXXXXXXX")
  MANIFEST_DATEIEN=0
  while IFS=$'\t' read -r SOLL_HASH SOLL_GROESSE REL_B64; do
    [[ ${SOLL_HASH:-} =~ ^[0-9a-fA-F]{64}$ &&
       ${SOLL_GROESSE:-} =~ ^[0-9]+$ && -n ${REL_B64:-} ]] ||
      abbruch "Ungueltige Zeile in MANIFEST.tsv."
    b64_nach_variable REL "$REL_B64" || abbruch "Ungueltiger Base64-Pfad im Manifest."
    manifest_pfad_sicher "$REL" || abbruch "Unsicherer Pfad im Manifest."
    enthaelt_steuerzeichen "$REL" && abbruch "Steuerzeichen im Manifestpfad sind nicht zulässig."
    [[ $REL != MANIFEST.tsv && $REL != MANIFEST.tsv.sha256 ]] ||
      abbruch "Das Manifest darf sich und seine Prüfsumme nicht selbst auflisten."
    [[ -f $SNAPSHOT/$REL && ! -L $SNAPSHOT/$REL ]] ||
      abbruch "Manifest-Datei fehlt oder ist ein Link: $REL"
    IST_GROESSE=$(wc -c < "$SNAPSHOT/$REL" | tr -d ' ')
    [[ $IST_GROESSE == "$SOLL_GROESSE" ]] ||
      abbruch "Groesse stimmt nicht: $REL"
    IST_HASH=$(sha_datei "$SNAPSHOT/$REL" | tr 'A-F' 'a-f')
    SOLL_HASH=$(printf '%s' "$SOLL_HASH" | tr 'A-F' 'a-f')
    [[ $IST_HASH == "$SOLL_HASH" ]] ||
      abbruch "Pruefsumme stimmt nicht: $REL"
    printf '%s\n' "$REL" >> "$MANIFEST_LIST"
    MANIFEST_DATEIEN=$((MANIFEST_DATEIEN + 1))
  done < "$SNAPSHOT/MANIFEST.tsv"
  [[ $(wc -l < "$MANIFEST_LIST" | tr -d ' ') == "$MANIFEST_DATEIEN" ]] ||
    abbruch "Manifestpfade mit Zeilenumbruechen sind nicht zulaessig."
  [[ -z $(LC_ALL=C sort "$MANIFEST_LIST" | uniq -d) ]] ||
    abbruch "Das Manifest enthaelt denselben Pfad mehrfach."
  while IFS= read -r -d '' SPEZIAL; do
    abbruch "Der Snapshot enthaelt einen Link oder eine Spezialdatei: ${SPEZIAL#"$SNAPSHOT/"}"
  done < <(find "$SNAPSHOT" ! -type f ! -type d -print0)
  SNAPSHOT_DATEIEN=$(find "$SNAPSHOT" -type f | wc -l | tr -d ' ')
  [[ $SNAPSHOT_DATEIEN == $((MANIFEST_DATEIEN + 2)) ]] ||
    abbruch "Dateimenge und Manifest stimmen nicht ueberein; der Snapshot enthaelt unmanifestierte oder fehlende Dateien."
fi

STAGE=$(mktemp -d "$AUSGABE_ELTERN/.notfall-rettung.XXXXXXXX")
BERICHT=$STAGE/RETTUNGSBERICHT.txt
SQL_ERROR_LOG=$STAGE/.sqlite-errors
BENUTZT=$STAGE/.benutzte-quellen
CASE_MAP=$STAGE/.fallnamen
: > "$BENUTZT"
: > "$CASE_MAP"
: > "$SQL_ERROR_LOG"
{
  printf 'Notfall-Rettung aus einer Gesamtsicherung\n'
  printf 'Quelle: %s\n' "$SNAPSHOT"
  printf 'Beginn (lokal): %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
  printf 'Manifest geprueft: %s\n' "$PRUEFEN"
  printf '\nBefunde und Anpassungen:\n'
} > "$BERICHT"

befund() {
  FEHLER=$((FEHLER + 1))
  printf -- '- FEHLER: %s\n' "$*" >> "$BERICHT"
}

anpassung() {
  printf -- '- ANPASSUNG: %s\n' "$*" >> "$BERICHT"
}

# Auch SQLite-Aufrufe in Process Substitutions laufen in einer Subshell, deren
# Rückgabecode Bash sonst nicht an die äußere while-Schleife weiterreicht. Der
# Wrapper protokolliert jeden technischen SQL-Fehler in einer gemeinsamen
# Datei; vor der Veröffentlichung wird daraus zwingend ein sichtbarer Befund.
sqlite3() {
  set +e
  command sqlite3 "$@"
  local rc=$?
  set -e
  if ((rc != 0)); then
    printf 'rc=%d argument=%s\n' "$rc" "${*: -1}" >> "$SQL_ERROR_LOG"
  fi
  return "$rc"
}

if [[ $PRUEFEN != ja ]]; then
  befund "Pruefsummen wurden auf ausdruecklichen Wunsch uebersprungen."
fi
if [[ -f $SNAPSHOT/STATUS.txt ]] && ! grep -qx 'VOLLSTAENDIG' "$SNAPSHOT/STATUS.txt"; then
  befund "Die Quellsicherung ist als UNVOLLSTAENDIG gekennzeichnet."
fi

sql_hat_tabelle() {
  [[ $(sqlite3 -batch -noheader "$1" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$2';" 2>/dev/null) == 1 ]]
}

sql_hat_spalte() {
  [[ $(sqlite3 -batch -noheader "$1" "SELECT count(*) FROM pragma_table_info('$2') WHERE name='$3';" 2>/dev/null) == 1 ]]
}

bereinige_komponente() {
  local original=$1 s ober basis bytes
  s=${original//$'\n'/ }
  s=${s//$'\r'/ }
  s=${s//$'\t'/ }
  s=${s//\//_}
  s=${s//\\/_}
  s=${s//:/_}
  s=${s//\*/_}
  s=${s//\?/_}
  s=${s//\"/_}
  s=${s//</_}
  s=${s//>/_}
  s=${s//|/_}
  s=$(printf '%s' "$s" | LC_ALL=C tr '\001-\037\177' ' ' |
    sed 's/[[:space:]][[:space:]]*/ /g;s/^[ .]*//;s/[ .]*$//')
  [[ -n $s ]] || s=Unbenannt
  ober=$(printf '%s' "$s" | tr '[:lower:]' '[:upper:]')
  basis=${ober%%.*}
  case "$basis" in
    CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]) s=_$s ;;
  esac
  bytes=$(printf '%s' "$s" | wc -c | tr -d ' ')
  while ((bytes > 240)); do
    s=${s%?}
    bytes=$(printf '%s' "$s" | wc -c | tr -d ' ')
  done
  [[ -n $s ]] || s=Unbenannt
  BEREINIGT=$s
  if [[ $BEREINIGT != "$original" ]]; then
    anpassung "Name bereinigt: '$original' -> '$BEREINIGT'"
  fi
}

bereinige_relordner() {
  local roh=$1 teil rest weiter
  BEREINIGTER_ORDNER=
  rest=$roh
  while :; do
    if [[ $rest == */* ]]; then
      teil=${rest%%/*}
      rest=${rest#*/}
      weiter=ja
    else
      teil=$rest
      weiter=nein
    fi
    if [[ -n $teil ]]; then
      bereinige_komponente "$teil"
      if [[ -z $BEREINIGTER_ORDNER ]]; then
        BEREINIGTER_ORDNER=$BEREINIGT
      else
        BEREINIGTER_ORDNER=$BEREINIGTER_ORDNER/$BEREINIGT
      fi
    fi
    [[ $weiter == ja ]] || break
  done
}

name_existiert_ci() {
  local ordner=$1 name=$2 p n key zielkey
  [[ -d $ordner ]] || return 1
  zielkey=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')
  for p in "$ordner"/*; do
    [[ -e $p ]] || continue
    n=${p##*/}
    key=$(printf '%s' "$n" | tr '[:upper:]' '[:lower:]')
    [[ $key == "$zielkey" ]] && return 0
  done
  return 1
}

eindeutiger_pfad() {
  local ordner=$1 name=$2 basis endung kandidat nr
  bereinige_komponente "$name"
  name=$BEREINIGT
  basis=$name
  endung=
  if [[ $name == *.* && $name != .* ]]; then
    basis=${name%.*}
    endung=.${name##*.}
  fi
  kandidat=$name
  nr=2
  while name_existiert_ci "$ordner" "$kandidat"; do
    kandidat=$basis\ \($nr\)$endung
    nr=$((nr + 1))
  done
  if [[ $kandidat != "$name" ]]; then
    KOLLISIONEN=$((KOLLISIONEN + 1))
    anpassung "Namenskollision sichtbar aufgeloest: '$name' -> '$kandidat'"
  fi
  UNIQUE_PATH=$ordner/$kandidat
}

markiere_benutzt() {
  local rel
  rel=${1#"$SNAPSHOT/"}
  printf '%s\n' "$(b64 "$rel")" >> "$BENUTZT"
}

ist_benutzt() {
  local rel code
  rel=${1#"$SNAPSHOT/"}
  code=$(b64 "$rel")
  grep -Fqx -- "$code" "$BENUTZT"
}

kopiere_klar() {
  local quelle=$1 zielordner=$2 name=$3
  if [[ ! -f $quelle || -L $quelle ]]; then
    befund "Quelldatei fehlt: ${quelle#"$SNAPSHOT/"}"
    return 1
  fi
  bereinige_relordner "$zielordner"
  zielordner=$STAGE/$BEREINIGTER_ORDNER
  mkdir -p -- "$zielordner"
  eindeutiger_pfad "$zielordner" "$name"
  cp -p -- "$quelle" "$UNIQUE_PATH"
  markiere_benutzt "$quelle"
  KOPIERT=$((KOPIERT + 1))
  return 0
}

DB=$SNAPSHOT/datenbank/betreuungsbuero.sqlite3
DB_OK=ja
if [[ ! -f $DB || -L $DB ]]; then
  befund "SQLite-Sicherung fehlt; nur Rohdateien koennen gerettet werden."
  DB_OK=nein
else
  INTEGRITAET=$(sqlite3 -batch -noheader "$DB" 'PRAGMA integrity_check;' 2>/dev/null || true)
  if [[ $INTEGRITAET != ok ]]; then
    befund "SQLite-Sicherung ist nicht integer; nur Rohdateien werden gerettet."
    DB_OK=nein
  else
    FK_FEHLER=$(sqlite3 -batch -noheader "$DB" 'PRAGMA foreign_key_check;' 2>/dev/null || true)
    if [[ -n $FK_FEHLER ]]; then
      befund "SQLite-Sicherung hat Fremdschluesselverletzungen; nur Rohdateien werden gerettet."
      DB_OK=nein
    fi
  fi
fi

MAP=$SNAPSHOT/verwaltung/WURZELN.map
if [[ ! -f $MAP ]]; then
  befund "Wurzelzuordnung fehlt; Datenbank-Zuordnung wird uebersprungen."
  DB_OK=nein
fi

map_ziel() {
  local art=$1 id=$2 a i qh zh
  MAP_ZIEL=
  [[ -f $MAP ]] || return 1
  while IFS='|' read -r a i qh zh; do
    if [[ $a == "$art" && $i == "$id" ]]; then
      hex_nach_variable MAP_ZIEL "$zh"
      return 0
    fi
  done < "$MAP"
  return 1
}

normalisiere_geburt() {
  local d=$1
  GEBURT=
  if [[ $d =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2}) ]]; then
    GEBURT=${BASH_REMATCH[1]:2:2}${BASH_REMATCH[2]}${BASH_REMATCH[3]}
  elif [[ $d =~ ^([0-9]{2})[./]([0-9]{2})[./]([0-9]{4}) ]]; then
    GEBURT=${BASH_REMATCH[3]:2:2}${BASH_REMATCH[2]}${BASH_REMATCH[1]}
  fi
}

if [[ $DB_OK == ja ]] && sql_hat_tabelle "$DB" cases; then
  ARCHIV_EXPR=0
  sql_hat_spalte "$DB" cases archived && ARCHIV_EXPR="COALESCE(c.archived,0)"
  while IFS='|' read -r ID_HEX LABEL_HEX GEB_HEX DOPPELT ARCHIV; do
    hex_nach_variable CASE_ID "$ID_HEX"
    hex_nach_variable LABEL "$LABEL_HEX"
    hex_nach_variable GEB_RAW "$GEB_HEX"
    bereinige_komponente "${LABEL:-Unbekannter Fall}"
    FALL_NAME=$BEREINIGT
    if ((DOPPELT > 1)); then
      normalisiere_geburt "$GEB_RAW"
      if [[ -n $GEBURT ]]; then
        FALL_NAME=$FALL_NAME\ $GEBURT
      else
        FALL_NAME=$FALL_NAME\ ${CASE_ID:0:8}
        anpassung "Namensgleicher Fall ohne lesbares Geburtsdatum erhielt die Fallkennung."
      fi
    fi
    NAME_KEY=$(printf '%s' "$FALL_NAME" | tr '[:upper:]' '[:lower:]')
    while IFS='|' read -r _ MAP_NAME_HEX _ _; do
      [[ -n ${MAP_NAME_HEX:-} ]] || continue
      hex_nach_variable MAP_NAME "$MAP_NAME_HEX"
      MAP_KEY=$(printf '%s' "$MAP_NAME" | tr '[:upper:]' '[:lower:]')
      if [[ $MAP_KEY == "$NAME_KEY" ]]; then
        FALL_NAME=$FALL_NAME\ ${CASE_ID:0:8}
        NAME_KEY=$(printf '%s' "$FALL_NAME" | tr '[:upper:]' '[:lower:]')
        anpassung "Auch Name und Geburtsdatum waren gleich; die Fallkennung wurde ergaenzt."
        break
      fi
    done < "$CASE_MAP"
    ANFANG=${FALL_NAME:0:1}
    case "$ANFANG" in
      Ä|ä) BUCHSTABE=A ;;
      Ö|ö) BUCHSTABE=O ;;
      Ü|ü) BUCHSTABE=U ;;
      [A-Za-z]) BUCHSTABE=$(printf '%s' "$ANFANG" | tr '[:lower:]' '[:upper:]') ;;
      *) BUCHSTABE=Z ;;
    esac
    printf '%s|%s|%s|%s\n' "$ID_HEX" \
      "$(printf '%s' "$FALL_NAME" | LC_ALL=C od -An -tx1 | tr -d ' \n')" \
      "$BUCHSTABE" "$ARCHIV" >> "$CASE_MAP"
  done < <(sqlite3 -batch -noheader "$DB" "
    WITH safe AS (
      SELECT c.*, CASE WHEN json_valid(c.stammdaten_json)
                       THEN c.stammdaten_json ELSE '{}' END AS j
        FROM cases c
    )
    SELECT hex(c.id)||'|'||hex(c.label)||'|'||
           hex(COALESCE(
             CASE WHEN typeof(json_extract(c.j,'\$.person.birthDate'))='text'
                  THEN json_extract(c.j,'\$.person.birthDate') END,
             CASE WHEN typeof(json_extract(c.j,'\$.person.geburtsdatum'))='text'
                  THEN json_extract(c.j,'\$.person.geburtsdatum') END,
             CASE WHEN typeof(json_extract(c.j,'\$.birthDate'))='text'
                  THEN json_extract(c.j,'\$.birthDate') END,
             CASE WHEN typeof(json_extract(c.j,'\$.geburtsdatum'))='text'
                  THEN json_extract(c.j,'\$.geburtsdatum') END,
             ''))||'|'||
           (SELECT count(*) FROM cases x WHERE lower(x.label)=lower(c.label))||'|'||
           $ARCHIV_EXPR
      FROM safe c ORDER BY c.label COLLATE NOCASE,c.id;")
fi

fallordner() {
  local id_hex=$1 k v buchstabe archiv
  FALL_ORDNER=
  FALL_PFAD=
  while IFS='|' read -r k v buchstabe archiv; do
    if [[ $k == "$id_hex" ]]; then
      hex_nach_variable FALL_ORDNER "$v"
      if [[ $archiv == 1 ]]; then
        FALL_PFAD=Fallakten-Archiv/$FALL_ORDNER
      else
        FALL_PFAD=Fallakten/${buchstabe:-Z}/$FALL_ORDNER
      fi
      return 0
    fi
  done < "$CASE_MAP"
  FALL_ORDNER=Unbekannter\ Fall\ ${id_hex:0:8}
  FALL_PFAD=Fallakten/Z/$FALL_ORDNER
  return 1
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
  local id=$1 area=$2 fall_hex=$3 storage=$4 root
  FOUND_PATH=
  ROOT_LIST=$STAGE/.suchwurzeln
  : > "$ROOT_LIST"
  if map_ziel STORAGE ""; then
    printf '%s\n' "$SNAPSHOT/$MAP_ZIEL" >> "$ROOT_LIST"
  fi
  if [[ $area == case ]] && map_ziel CASE "$fall_hex"; then
    printf '%s\n' "$SNAPSHOT/$MAP_ZIEL" >> "$ROOT_LIST"
  fi
  if map_ziel BASE ""; then
    printf '%s\n' "$SNAPSHOT/$MAP_ZIEL" >> "$ROOT_LIST"
  fi
  printf '%s\n' "$SNAPSHOT/inhalt/server-data/Dokumentenspeicher" >> "$ROOT_LIST"
  printf '%s\n' "$SNAPSHOT/inhalt/server-data/files" >> "$ROOT_LIST"
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

quelle_passt() {
  local quelle=$1 groesse=$2 sha=$3 ist
  [[ -f $quelle && ! -L $quelle ]] || return 1
  if [[ $groesse =~ ^[0-9]+$ ]]; then
    ist=$(wc -c < "$quelle" | tr -d ' ')
    [[ $ist == "$groesse" ]] || return 1
  fi
  if [[ -n $sha ]]; then
    ist=$(sha_datei "$quelle" | tr 'A-F' 'a-f')
    sha=$(printf '%s' "$sha" | tr 'A-F' 'a-f')
    [[ $ist == "$sha" ]] || return 1
  fi
  return 0
}

if [[ $DB_OK == ja ]] && sql_hat_tabelle "$DB" doc_files; then
  STORAGE_EXPR="''"
  sql_hat_spalte "$DB" doc_files storage_relpath && STORAGE_EXPR="f.storage_relpath"
  while IFS='|' read -r ID_HEX AREA_HEX FALL_HEX NAME_HEX ORDNER_HEX DELETED_HEX STORAGE_HEX SIZE SHA_HEX; do
    hex_nach_variable ID "$ID_HEX"
    hex_nach_variable AREA "$AREA_HEX"
    hex_nach_variable NAME "$NAME_HEX"
    hex_nach_variable ORDNER "$ORDNER_HEX"
    hex_nach_variable DELETED "$DELETED_HEX"
    hex_nach_variable STORAGE "$STORAGE_HEX"
    hex_nach_variable SHA "$SHA_HEX"
    [[ -n $NAME ]] || NAME=$ID
    if [[ $AREA == case ]]; then
      fallordner "$FALL_HEX" || true
      BASIS=$FALL_PFAD
    elif [[ $AREA == office ]]; then
      BASIS=Büroorganisation
    else
      BASIS=_Andere_Bereiche/$AREA
    fi
    if [[ -n $DELETED ]]; then
      BASIS=_Papierkorb/$BASIS
    fi
    [[ -z $ORDNER ]] || BASIS=$BASIS/$ORDNER
    if finde_zentral "$ID" "$AREA" "$FALL_HEX" "$STORAGE" &&
       quelle_passt "$FOUND_PATH" "$SIZE" "$SHA"; then
      kopiere_klar "$FOUND_PATH" "$BASIS" "$NAME" || true
    else
      befund "Zentrales Dokument fehlt oder stimmt nicht: $NAME ($ID)"
    fi
  done < <(sqlite3 -batch -noheader "$DB" "
    WITH RECURSIVE p(id,area,case_id,pfad,gesehen,tiefe) AS (
      SELECT d.id,d.area,d.case_id,d.name,','||d.id||',',1
        FROM doc_folders d
       WHERE d.parent_id='' OR NOT EXISTS
             (SELECT 1 FROM doc_folders x WHERE x.id=d.parent_id)
      UNION ALL
      SELECT d.id,d.area,d.case_id,p.pfad||'/'||d.name,
             p.gesehen||d.id||',',p.tiefe+1
        FROM doc_folders d JOIN p ON d.parent_id=p.id
       WHERE p.tiefe<100 AND instr(p.gesehen,','||d.id||',')=0
    )
    SELECT hex(f.id)||'|'||hex(f.area)||'|'||hex(f.case_id)||'|'||hex(f.name)||'|'||
           hex(COALESCE((SELECT pfad FROM p WHERE id=f.folder_id LIMIT 1),''))||'|'||
           hex(f.deleted_at)||'|'||hex($STORAGE_EXPR)||'|'||f.size||'|'||hex(f.sha256)
      FROM doc_files f ORDER BY f.area,f.case_id,f.created_at,f.id;")
fi

if [[ $DB_OK == ja ]] && sql_hat_tabelle "$DB" doc_versions; then
  V_STORAGE_EXPR="''"
  sql_hat_spalte "$DB" doc_versions storage_relpath && V_STORAGE_EXPR="v.storage_relpath"
  while IFS='|' read -r ID_HEX AREA_HEX FALL_HEX NAME_HEX STORAGE_HEX SIZE SHA_HEX; do
    hex_nach_variable ID "$ID_HEX"
    hex_nach_variable AREA "$AREA_HEX"
    hex_nach_variable NAME "$NAME_HEX"
    hex_nach_variable STORAGE "$STORAGE_HEX"
    hex_nach_variable SHA "$SHA_HEX"
    if [[ $AREA == case ]]; then
      fallordner "$FALL_HEX" || true
      BASIS="Büroorganisation/_Verwaltung & Sicherungen/_Technik/Versionen/$FALL_PFAD"
    else
      BASIS="Büroorganisation/_Verwaltung & Sicherungen/_Technik/Versionen/Büroorganisation"
    fi
    if finde_zentral "$ID" "$AREA" "$FALL_HEX" "$STORAGE" &&
       quelle_passt "$FOUND_PATH" "$SIZE" "$SHA"; then
      kopiere_klar "$FOUND_PATH" "$BASIS" "${NAME:-Version-$ID}" || true
    else
      befund "Dokumentversion fehlt oder stimmt nicht: $ID"
    fi
  done < <(sqlite3 -batch -noheader "$DB" "
    SELECT hex(v.id)||'|'||hex(COALESCE(f.area,'office'))||'|'||
           hex(COALESCE(f.case_id,''))||'|'||hex(v.name)||'|'||
           hex($V_STORAGE_EXPR)||'|'||v.size||'|'||hex(v.sha256)
      FROM doc_versions v LEFT JOIN doc_files f ON f.id=v.file_id ORDER BY v.created_at,v.id;")
fi

finde_moduldatei() {
  local basis=$1 id=$2
  FOUND_PATH=
  id_sicher "$id" || return 1
  variante_in_ordner "$basis" "$id"
}

# Stufe 4: Fachmodule zeigen ueber doc_links auf den einen zentralen Dateiinhalt.
# Ist dieser Pfad vorhanden, wurde er oben bereits als doc_files-Dokument mit
# Klarname und logischem Ordner gerettet; eine zweite Modulkopie ist weder noetig
# noch erwuenscht. Legacy-Verzeichnisse bleiben Fallback fuer Altbestand.
finde_modul_link() {
  local modul=$1 owner_hex=$2 slot_hex=$3 geteilt=${4:-nein}
  local fall_erwartet_hex=${5:-}
  local storage_expr="''" zeile id_hex area_hex fall_hex storage_hex
  local LINK_FILE_ID LINK_AREA LINK_STORAGE
  FOUND_PATH=
  [[ $modul =~ ^[a-z][a-z0-9-]*$ ]] || return 1
  [[ $owner_hex =~ ^([0-9A-Fa-f][0-9A-Fa-f])*$ ]] || return 1
  [[ $slot_hex =~ ^([0-9A-Fa-f][0-9A-Fa-f])*$ ]] || return 1
  [[ $fall_erwartet_hex =~ ^([0-9A-Fa-f][0-9A-Fa-f])*$ ]] || return 1
  sql_hat_tabelle "$DB" doc_links || return 1
  sql_hat_tabelle "$DB" doc_files || return 1
  sql_hat_spalte "$DB" doc_files storage_relpath && storage_expr='f.storage_relpath'
  if [[ $geteilt == ja ]]; then
    zeile=$(sqlite3 -batch -noheader "$DB" "
      SELECT hex(f.id)||'|'||hex(f.area)||'|'||hex(f.case_id)||'|'||hex($storage_expr)
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='$modul' AND lower(hex(l.slot))=lower('$slot_hex')
         AND ('$fall_erwartet_hex'='' OR
              lower(hex(f.case_id))=lower('$fall_erwartet_hex'))
         AND COALESCE(f.deleted_at,'')=''
       ORDER BY CASE WHEN lower(hex(l.owner_id))=lower('$owner_hex') THEN 0 ELSE 1 END,
                l.created_at,l.owner_id
       LIMIT 1;")
  else
    zeile=$(sqlite3 -batch -noheader "$DB" "
      SELECT hex(f.id)||'|'||hex(f.area)||'|'||hex(f.case_id)||'|'||hex($storage_expr)
        FROM doc_links l JOIN doc_files f ON f.id=l.file_id
       WHERE l.module='$modul' AND lower(hex(l.owner_id))=lower('$owner_hex')
         AND lower(hex(l.slot))=lower('$slot_hex') AND COALESCE(f.deleted_at,'')=''
         AND ('$fall_erwartet_hex'='' OR
              lower(hex(f.case_id))=lower('$fall_erwartet_hex'))
       ORDER BY l.created_at LIMIT 1;")
  fi
  [[ -n $zeile ]] || return 1
  IFS='|' read -r id_hex area_hex fall_hex storage_hex <<< "$zeile"
  hex_nach_variable LINK_FILE_ID "$id_hex"
  hex_nach_variable LINK_AREA "$area_hex"
  hex_nach_variable LINK_STORAGE "$storage_hex"
  finde_zentral "$LINK_FILE_ID" "$LINK_AREA" "$fall_hex" "$LINK_STORAGE"
}

datum_ordner() {
  local d=$1 fallback=${2:-1970-01-01}
  [[ $d =~ ^[0-9]{4}-[0-9]{2} ]] || d=$fallback
  [[ $d =~ ^[0-9]{4}-[0-9]{2} ]] || d=1970-01-01
  DATUM_JAHR=${d:0:4}
  DATUM_MONAT=${d:5:2}
}

rette_modul_einfach() {
  local tabelle=$1 query=$2 wurzel=$3 art=$4 modul=$5 owner_art=$6 slot_art=$7
  local link_owner_hex link_slot_hex
  sql_hat_tabelle "$DB" "$tabelle" || return 0
  while IFS='|' read -r ID_HEX OWNER_HEX NAME_HEX DATUM_HEX FALL_HEX; do
    hex_nach_variable ID "$ID_HEX"
    hex_nach_variable OWNER "$OWNER_HEX"
    hex_nach_variable NAME "$NAME_HEX"
    hex_nach_variable DATUM "$DATUM_HEX"
    [[ $owner_art == id ]] && link_owner_hex=$ID_HEX || link_owner_hex=$OWNER_HEX
    case "$slot_art" in
      id) link_slot_hex=$ID_HEX ;;
      owner) link_slot_hex=$OWNER_HEX ;;
      *) link_slot_hex= ;;
    esac
    # Zentrale Datei wurde im doc_files-Lauf bereits an ihrer verbindlichen
    # Taxonomieposition ausgegeben. Keine zweite, konkurrierende Modulablage erzeugen.
    if finde_modul_link "$modul" "$link_owner_hex" "$link_slot_hex"; then
      continue
    fi
    BASIS_QUELLE=$SNAPSHOT/inhalt/server-data/$wurzel
    [[ -z $OWNER ]] || BASIS_QUELLE=$BASIS_QUELLE/$OWNER
    if ! finde_moduldatei "$BASIS_QUELLE" "$ID"; then
      befund "$tabelle: Datei fehlt ($ID)."
      continue
    fi
    datum_ordner "$DATUM"
    case "$art" in
      fall)
        fallordner "$FALL_HEX" || true
        ZIEL=$FALL_PFAD/12\ -\ Abschluss\ \&\ Herausgabe/Erzeugte\ Dokumente
        ;;
      inbox)
        ZIEL=Büroorganisation/Posteingang/$DATUM_JAHR/$DATUM_MONAT
        ;;
      receipt)
        ZIEL=Büroorganisation/Finanzen/Belege/$DATUM_JAHR/$DATUM_MONAT
        ;;
      statement)
        ZIEL=Büroorganisation/Finanzen/Kontoauszüge/$DATUM_JAHR/$DATUM_MONAT
        ;;
      calendar)
        ZIEL=Büroorganisation/Kalender/Anlagen/$OWNER
        ;;
      todo)
        ZIEL=Büroorganisation/Aufgaben/Anlagen/$OWNER
        ;;
    esac
    kopiere_klar "$FOUND_PATH" "$ZIEL" "${NAME:-Datei-$ID}" || true
  done < <(sqlite3 -batch -noheader "$DB" "$query")
}

if [[ $DB_OK == ja ]]; then
  rette_modul_einfach case_documents \
    "SELECT hex(id)||'|'||hex(case_id)||'|'||hex(filename)||'|'||hex(created_at)||'|'||hex(case_id) FROM case_documents ORDER BY id;" \
    case-documents fall case-document id leer
  rette_modul_einfach inbox_documents \
    "SELECT hex(id)||'||'||hex(file_name)||'|'||hex(COALESCE(NULLIF(received_date,''),NULLIF(inbox_date,''),created_at))||'|' FROM inbox_documents ORDER BY id;" \
    inbox-documents inbox inbox id leer
  rette_modul_einfach finance_receipts \
    "SELECT hex(id)||'||'||hex(filename)||'|'||hex(COALESCE(NULLIF(invoice_date,''),uploaded_at))||'|' FROM finance_receipts ORDER BY id;" \
    finance-receipts receipt finance-receipt id leer
  rette_modul_einfach finance_statements \
    "SELECT hex(id)||'||'||hex(filename)||'|'||hex(uploaded_at)||'|' FROM finance_statements ORDER BY id;" \
    finance-statements statement finance-statement id leer
  rette_modul_einfach calendar_event_attachments \
    "SELECT hex(id)||'|'||hex(event_id)||'|'||hex(filename)||'|'||hex(created_at)||'|' FROM calendar_event_attachments ORDER BY id;" \
    calendar-event-attachments calendar calendar-attachment owner id
  rette_modul_einfach todo_attachments \
    "SELECT hex(id)||'|'||hex(todo_id)||'|'||hex(filename)||'|'||hex(created_at)||'|' FROM todo_attachments ORDER BY id;" \
    todo-attachments todo todo-attachment owner id
fi

if [[ $DB_OK == ja ]] && sql_hat_tabelle "$DB" office_profile; then
  while IFS='|' read -r NAME_HEX MIME_HEX; do
    hex_nach_variable NAME "$NAME_HEX"
    hex_nach_variable MIME "$MIME_HEX"
    DEFAULT_HEX=$(hex default)
    OFFICE_PROFILE_HEX=$(hex office-profile)
    LOGO_HEX=$(hex logo)
    if finde_modul_link office-logo "$DEFAULT_HEX" "" ||
       finde_modul_link office-logo "$OFFICE_PROFILE_HEX" "$LOGO_HEX"; then
      continue
    fi
    QUELLE=$SNAPSHOT/inhalt/server-data/office-logo/$NAME
    ENDUNG=${NAME##*.}
    [[ $ENDUNG != "$NAME" && ${#ENDUNG} -le 10 ]] || ENDUNG=bin
    kopiere_klar "$QUELLE" "Büroorganisation/Büroprofil" "Bürologo.$ENDUNG" || true
  done < <(sqlite3 -batch -noheader "$DB" \
    "SELECT hex(logo_filename)||'|'||hex(logo_mime_type) FROM office_profile WHERE id=1 AND logo_filename!='';")
fi

doku_datum() {
  local fachlich=$1 angelegt=$2
  if [[ $fachlich =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2}) ]]; then
    D_JAHR=${BASH_REMATCH[1]}; D_MONAT=${BASH_REMATCH[2]}; D_TAG=${BASH_REMATCH[3]}
  elif [[ $fachlich =~ ^([0-9]{2})[./]([0-9]{2})[./]([0-9]{4}) ]]; then
    D_JAHR=${BASH_REMATCH[3]}; D_MONAT=${BASH_REMATCH[2]}; D_TAG=${BASH_REMATCH[1]}
  elif [[ $angelegt =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2}) ]]; then
    D_JAHR=${BASH_REMATCH[1]}; D_MONAT=${BASH_REMATCH[2]}; D_TAG=${BASH_REMATCH[3]}
  else
    D_JAHR=1970; D_MONAT=01; D_TAG=01
    anpassung "Falldokumentation ohne lesbares Datum erhielt 1970-01-01."
  fi
  if [[ $angelegt =~ [T\ ]([0-9]{2}):([0-9]{2}) ]]; then
    D_UHR=${BASH_REMATCH[1]}${BASH_REMATCH[2]}
  else
    D_UHR=0000
  fi
}

finde_doku() {
  local fall=$1 eintrag=$2 foto=$3 basis d
  FOUND_PATH=
  id_sicher "$fall" && id_sicher "$eintrag" && id_sicher "$foto" || return 1
  basis=$SNAPSHOT/inhalt/server-data/case-doku-photos/$fall
  if [[ -f $basis/_dateien/$foto && ! -L $basis/_dateien/$foto ]]; then
    FOUND_PATH=$basis/_dateien/$foto
    return 0
  fi
  if [[ -f $basis/$eintrag/$foto && ! -L $basis/$eintrag/$foto ]]; then
    FOUND_PATH=$basis/$eintrag/$foto
    return 0
  fi
  for d in "$basis"/*; do
    [[ -d $d && -f $d/$foto && ! -L $d/$foto ]] || continue
    FOUND_PATH=$d/$foto
    return 0
  done
  return 1
}

if [[ $DB_OK == ja ]] && sql_hat_tabelle "$DB" case_doku_entries; then
  while IFS='|' read -r FALL_HEX EINTRAG_HEX FOTO_HEX NAME_HEX FACHLICH_HEX ART_HEX ANGELEGT_HEX; do
    hex_nach_variable FALL "$FALL_HEX"
    hex_nach_variable EINTRAG "$EINTRAG_HEX"
    hex_nach_variable FOTO "$FOTO_HEX"
    hex_nach_variable NAME "$NAME_HEX"
    hex_nach_variable FACHLICH "$FACHLICH_HEX"
    hex_nach_variable DOKU_ART "$ART_HEX"
    hex_nach_variable ANGELEGT "$ANGELEGT_HEX"
    fallordner "$FALL_HEX" || true
    doku_datum "$FACHLICH" "$ANGELEGT"
    bereinige_komponente "${DOKU_ART:-Eintrag}"
    EINTRAGSORDNER=${D_JAHR:2:2}$D_MONAT$D_TAG\ $D_UHR\ $BEREINIGT
    ZIEL=$FALL_PFAD/11\ -\ Betreuungsführung/Falldokumentation/$D_JAHR/$D_MONAT/$EINTRAGSORDNER
    if finde_modul_link doku-photo "$EINTRAG_HEX" "$FOTO_HEX" ja "$FALL_HEX"; then
      :
    elif finde_doku "$FALL" "$EINTRAG" "$FOTO"; then
      kopiere_klar "$FOUND_PATH" "$ZIEL" "${NAME:-Anlage-$FOTO}" || true
    else
      befund "Falldokumentations-Anlage fehlt: Fall $FALL, Foto $FOTO."
    fi
  done < <(sqlite3 -batch -noheader "$DB" "
    WITH safe AS (
      SELECT d.*, CASE WHEN json_valid(d.data_json)
                       THEN d.data_json ELSE '{\"photos\":[]}' END AS j
        FROM case_doku_entries d
    )
    SELECT hex(d.case_id)||'|'||hex(d.id)||'|'||
           hex(CAST(json_extract(p.value,'\$.id') AS TEXT))||'|'||
           hex(COALESCE(CAST(json_extract(p.value,'\$.filename') AS TEXT),'Anlage'))||'|'||
           hex(COALESCE(
             CASE WHEN typeof(json_extract(d.j,'\$.date'))='text'
                  THEN json_extract(d.j,'\$.date') END,
             CASE WHEN typeof(json_extract(d.j,'\$.datum'))='text'
                  THEN json_extract(d.j,'\$.datum') END,''))||'|'||
           hex(COALESCE(
             CASE WHEN typeof(json_extract(d.j,'\$.type'))='text'
                  THEN json_extract(d.j,'\$.type') END,
             CASE WHEN typeof(json_extract(d.j,'\$.detail'))='text'
                  THEN json_extract(d.j,'\$.detail') END,
             CASE WHEN typeof(json_extract(d.j,'\$.freeDetail'))='text'
                  THEN json_extract(d.j,'\$.freeDetail') END,'Eintrag'))||'|'||
           hex(d.created_at)
      FROM safe d, json_each(d.j, '\$.photos') p
     WHERE typeof(json_extract(p.value,'\$.id'))='text'
       AND json_extract(p.value,'\$.id')!=''
     ORDER BY d.case_id,d.created_at,d.id;")
fi

# Jede noch nicht ueber Metadaten zugeordnete Inhaltsdatei wird zusaetzlich unter
# _Ohne_Zuordnung bewahrt. Damit ueberleben auch Waisen und kuenftige Module die Rettung.
if [[ -d $SNAPSHOT/inhalt ]]; then
  while IFS= read -r -d '' QUELLE; do
    ist_benutzt "$QUELLE" && continue
    REL=${QUELLE#"$SNAPSHOT/inhalt/"}
    ORDNER=${REL%/*}
    DATEINAME=${REL##*/}
    [[ $ORDNER != "$REL" ]] || ORDNER=
    ZIEL=_Ohne_Zuordnung
    [[ -z $ORDNER ]] || ZIEL=$ZIEL/$ORDNER
    VORHER=$KOPIERT
    if kopiere_klar "$QUELLE" "$ZIEL" "$DATEINAME"; then
      ROH_KOPIERT=$((ROH_KOPIERT + 1))
    fi
  done < <(find "$SNAPSHOT/inhalt" -type f -print0)
fi

if [[ -s $SQL_ERROR_LOG ]]; then
  SQL_ERROR_COUNT=$(wc -l < "$SQL_ERROR_LOG" | tr -d ' ')
  befund "$SQL_ERROR_COUNT SQLite-Abfrage(n) sind technisch fehlgeschlagen; keine leere Ergebnismenge wurde als Erfolg gewertet."
fi
rm -f -- "$BENUTZT" "$CASE_MAP" "$STAGE/.suchwurzeln" "$SQL_ERROR_LOG"
{
  printf '\nZusammenfassung:\n'
  printf 'Klar zugeordnete und rohe Dateikopien gesamt: %d\n' "$KOPIERT"
  printf 'Davon ohne DB-Zuordnung bewahrt: %d\n' "$ROH_KOPIERT"
  printf 'Sichtbar aufgeloeste Namenskollisionen: %d\n' "$KOLLISIONEN"
  printf 'Fehler/Befunde: %d\n' "$FEHLER"
  printf 'Ende (lokal): %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
  if ((FEHLER)); then
    printf 'Ergebnis: UNVOLLSTAENDIG - die vorhandenen Dateien wurden trotzdem bewahrt.\n'
  else
    printf 'Ergebnis: VOLLSTAENDIG\n'
  fi
} >> "$BERICHT"
if ((FEHLER)); then
  printf 'UNVOLLSTAENDIG\n' > "$STAGE/STATUS.txt"
else
  printf 'VOLLSTAENDIG\n' > "$STAGE/STATUS.txt"
fi

mv -- "$STAGE" "$AUSGABE"
STAGE=
sync "$AUSGABE" 2>/dev/null || sync 2>/dev/null || true
printf 'RETTUNG=%s\n' "$AUSGABE"
if ((FEHLER)); then
  printf 'STATUS=UNVOLLSTAENDIG FEHLER=%d\n' "$FEHLER"
  exit 2
fi
printf 'STATUS=VOLLSTAENDIG DATEIEN=%d\n' "$KOPIERT"
exit 0
