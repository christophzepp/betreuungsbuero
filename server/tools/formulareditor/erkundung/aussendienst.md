# Befund: Drei Verteilwege für Eigenformulare

## (1) Außendienst-Datei — wo `kopf.dokumente` geschrieben wird

**Die Gegenstelle ist reiner App-Code, kein Servercode.** Die Außendienst-Datei wird komplett im Browser erzeugt: Block `aussendienst-1-v1` (App-HTML Z. 90895), Funktion `window.__adErzeugen` (Z. 91390).

Ablauf:
- `dokumenteLesen()` (Z. 90967–90975) baut die Auswahlliste aus dem **Laufzeit**-Katalog: `REPORTS` gefiltert auf Einträge, zu denen `SCHEMAS[r.id]` existiert.
- `kopf.dokumente` wird in Z. 91407 geschrieben (`{id,title}` je gewähltem Dokument), `kopf.pdfVorlagen` in Z. 91421 (nur amtliche Vorlagen aus `OFFICIAL_TEMPLATE_REGISTRY`).
- Die Datei entsteht per `document.documentElement.cloneNode(true)` (Z. 91532); die Nutzlast (Fälle + Büro) landet im Block `#embeddedFieldData` (statisch Z. 4746, Injektion Z. 91625–91627), Download Z. 91645ff.
- Gegenstück beim Öffnen: `aussendienst-2b-v1` (Z. 92284), Filter `REPORTS.splice(...REPORTS.filter(dokumentErlaubt))` in Z. 92374–92382.

**Warum serverseitige Eigenformulare heute NICHT ankommen:** Der Klon kopiert nur das **statische** HTML — also die eingebaute `const REPORTS`-Zeile (Z. 4856), `SCHEMAS` (Z. 4908) und die V159-Katalogzeile (Z. 28946, eingespleißt in Z. 28958). Zur Laufzeit per JS in `REPORTS`/`SCHEMAS` nachregistrierte Eigenformulare stehen nur im Arbeitsspeicher; `cloneNode` nimmt sie nicht mit. Beim Öffnen unter `file://` startet die Datei mit dem eingebauten Katalog, und der 2b-Filter würde eine Eigenformular-ID aus `kopf.dokumente` schlicht nicht finden — das Formular existiert dort nicht.

**Was passieren müsste:**
1. **Erzeugerseite:** Die Eigenformular-Definitionen (Katalogeintrag + Schema, ggf. Vorlagen-Referenz) müssen in die Nutzlast — sinnvollerweise als eigener Zweig in `bueroLesen()` (Z. 91002ff), wo bereits einzelne office-json-Sammlungen per `holen('/api/office-json/…')` abgeholt werden (Kontaktmonitor/Qualifikationen/suggestion_registry/case_intakes: Z. 91055–91058). Eine neue office-json-Sammlung reist dort **nicht automatisch** mit — jeder Bereich wird einzeln gefetcht und gemappt.
2. **Leseseite:** In `laden()` von `aussendienst-2b-v1` müssen die eingebetteten Eigenformulare **vor** dem `kopf.dokumente`-Filter (Z. 92374) in `REPORTS` und `SCHEMAS` registriert werden — der Block filtert heute nur, er fügt nie hinzu.
3. `dokumenteLesen()` listet Eigenformulare automatisch, sobald sie zur Laufzeit in `REPORTS`+`SCHEMAS` stehen — dort ist nichts zu tun.

## (2) Schlanke Auslieferung (slimDelivery)

- Route und Einbau: `server/index.js` Z. 267–269 (`createSlimDelivery`, `GET /api/pdf-vorlagen/:elementId` mit `requireAuth`) und Z. 310 (`appHandler` für `/` und die App-Datei).
- Mechanik: `server/src/app-slim-delivery.js` — reiner **Zeilenfilter** über die App-Datei. Erfasst werden ausschließlich einzeilige `<script type="application/pdf[;-]base64">`-Blöcke (Regex Z. 21); sie werden geleert und mit `data-server-template="1"` markiert (Z. 39), die Base64-Inhalte wandern in eine RAM-Map. `vorlagenHandler` (Z. 62–73) liefert nur, was in dieser Map steht; alles andere → 404 „Unbekannte Vorlage" (Z. 66).

**Auswirkung auf Eigenformulare ohne eingebettete PDF: keine.** Ein serverseitig (z. B. in office-json) gespeichertes Eigenformular hat keinen pdf-base64-Block in der App-Datei — slimDelivery leert nichts, cached nichts, und die Auslieferung ändert sich für dieses Formular nicht. Reine Baukasten-Formulare (Abschnitte+Felder, dynamisches PDF wie `free_document`) brauchen den Weg gar nicht.

**Aber:** Sobald ein Eigenformular eine **hochgeladene PDF-Vorlage** haben soll, greift der bestehende Weg nicht:
- `/api/pdf-vorlagen/:elementId` kennt nur Vorlagen aus der statischen App-Datei → 404 für Eigenformular-Vorlagen.
- Client-Konsumenten der Route: `embeddedPdfBytes()` (App-HTML Z. 7773–7793, Fetch Z. 7784) lädt im Exportmoment nur nach, wenn ein DOM-Element mit `data-server-template` **existiert** — für Eigenformulare gibt es kein Element, es fiele auf „Eingebettete PDF-Vorlage fehlt" (Z. 7793). Weitere Konsumenten: `tplDownloadable` (Z. 6761, „Vorlage herunterladen"-Anzeige) und der Außendienst-Export, der geleerte Blöcke vor dem Klonen per `?format=base64` nachlädt (Z. 91547–91559) — auch der findet nur Blöcke, die im Klon existieren.
- Eigenformular-PDFs bräuchten also eigenen Speicher + eigene Route (oder eine Erweiterung von `embeddedPdfBytes` um einen katalogbasierten statt DOM-basierten Nachschlag) und eine eigene Einbettung in die Außendienst-Nutzlast.

## (3) Sicherungen

**Heute gesichert:**
- **Gesamtsicherung** (`server/src/modules/backup/runner.js`, `runTotalBackup` Z. 735ff): ruft `server/tools/gesamt-backup.sh` mit SQLite-DB (`dbPath`), komplettem `runtime/data`-Baum (`dataDir` — inkl. Dokumentenspeicher-Bytes) und der ausgelieferten App-Datei (`appFileFor`, Z. 718–733). Zeitpläne/ZIP/Mount-Abgleich zusätzlich über `server/src/modules/backup/document-backup.js` (Kopfkommentar Z. 1–22: gesamt/zip/mount).
- **Portable Artefakte** (`server/src/modules/backup/portable-data.js`): `TABLE_REGISTRY` (Z. 23ff) ist die einzige Quelle, **tabellenweise**, per `SELECT *` (Z. 295). Darin:
  - *State je Fall:* `case_reports` (Feldwerte je Dokument je Fall; Registry Z. 99, Schema `server/src/database/index.js` Z. 51) und `cases.stammdaten_json` (Schema Z. 40, inkl. exportHistory/archives, s. `server/src/modules/cases/routes.js` Z. 136–150).
  - *office-json:* ganze Tabelle `office_json` in den Gruppen `office` + `module` (Registry Z. 98; Schema `database/index.js` Z. 96). Einzige Schlüssel-Sonderbehandlung: OCR-Hydrierung für `case_intakes` (Z. 757–769).
  - *Dokumentenspeicher:* `doc_folders`/`doc_files`/`doc_versions` etc. nur als Metadaten (`metadataOnly`, Registry Z. 130ff) — die Bytes sichert die Gesamtsicherung/`document-backup.js`.

**Landet eine neue office-json-Sammlung automatisch in Sicherung und Wiederherstellung? Ja.** Sicherung und Restore arbeiten tabellenweise: Export dumpt die ganze `office_json`-Tabelle, Restore ersetzt sie komplett (`prepareReplacement`: `DELETE FROM` + Neuinsert, portable-data.js Z. 1330). Ein neuer Schlüssel braucht **keinen** Eintrag in der Backup-Registry. Ebenso ist er in der SQLite-Vollsicherung automatisch enthalten.

**Vier Vorbehalte:**
1. Der Schlüssel muss in die Client-Whitelist `KEYS` (`server/src/modules/office/json-routes.js` Z. 28), sonst laufen GET/PUT auf 404 (Z. 199–200, 212–213) und die Daten entstehen serverseitig gar nicht erst — der dokumentierte Altbug (Kommentar Z. 24–30) ist genau dieses stille Verpuffen.
2. 15-MB-Deckel je Schlüssel (Z. 231–232) — relevant, falls Eigenformulare eingebettete PDF-Vorlagen als Base64 tragen sollen; dafür ist der Store ausdrücklich nicht gedacht.
3. Die **Fallübergabe** (Gruppe `case`) enthält `office_json` nicht (keine `caseColumn`) — büroweite Eigenformulare reisen bei einer Fallübergabe nicht mit; für ein büroweites Baukasten-Repertoire vermutlich gewollt, sollte aber bewusst entschieden werden.
4. Fallbezogene Sichtbarkeitsfilterung gibt es nur für Schlüssel in `FALLBEZOGENE_SCHLUESSEL` (Z. 36) — für eine büroweite Formularsammlung ohne Fallbezug irrelevant.

## Kurzfazit für den Formulareditor
Speicherung als neue office-json-Sammlung ist backup-seitig der bequemste Weg (automatisch in Voll- und Portabel-Sicherung). Die echte Arbeit liegt beim Außendienst (Einbetten in `bueroLesen` + Registrieren vor dem 2b-Filter) und — nur falls Eigenformulare eigene PDF-Vorlagen bekommen — bei einem eigenen Vorlagenweg neben `/api/pdf-vorlagen`, das ausschließlich die statisch eingebauten Vorlagen kennt.

## Codestellen
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:91390: window.__adErzeugen — Erzeugung der Außendienst-Datei (reiner App-Code, kein Server)
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:91407: kopf.dokumente wird geschrieben (Auswahl aus dokumenteLesen())
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:90967: dokumenteLesen(): Auswahlliste = Laufzeit-REPORTS gefiltert auf vorhandene SCHEMAS[id]
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:91532: document.documentElement.cloneNode(true) — nur statisches HTML wandert in die Datei, Laufzeit-Registrierungen nicht
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:91625: Injektion der Nutzlast in #embeddedFieldData (statischer Block: Z. 4746)
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:92374: aussendienst-2b-v1: Filter REPORTS auf kopf.dokumente (splice Z. 92380) — filtert nur, fügt nie hinzu
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:91055: bueroLesen(): office-json-Sammlungen werden einzeln gefetcht (kontaktmonitor/qualifikationen/suggestion_registry/case_intakes) — neue Sammlung reist nicht automatisch mit
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:4856: statische const REPORTS; SCHEMAS Z. 4908; V159-Katalogzeile Z. 28946, Einspleißen Z. 28958
- server/index.js:269: GET /api/pdf-vorlagen/:elementId (requireAuth) → slimDelivery.vorlagenHandler; appHandler Z. 310
- server/src/app-slim-delivery.js:21: VORLAGEN_ZEILE-Regex: nur einzeilige pdf-base64-Script-Blöcke der statischen App-Datei werden geleert/gecacht
- server/src/app-slim-delivery.js:66: vorlagenHandler: unbekannte elementId → 404 „Unbekannte Vorlage“ (Eigenformular-Vorlagen wären hier nie vorhanden)
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:7773: embeddedPdfBytes(): Server-Nachladen nur bei existierendem DOM-Element mit data-server-template (Fetch Z. 7784); sonst „Eingebettete PDF-Vorlage fehlt“
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:91547: Außendienst-Export lädt geleerte Vorlagen-Blöcke vor dem Klonen per /api/pdf-vorlagen/:id?format=base64 nach
- server/src/modules/backup/portable-data.js:98: TABLE_REGISTRY: office_json tabellenweise in Gruppen office+module → neue Schlüssel automatisch in Sicherung
- server/src/modules/backup/portable-data.js:99: case_reports (State je Fall/Dokument) in office+module+case; cases.stammdaten_json über casePrimary (Schema: server/src/database/index.js:40,51,96)
- server/src/modules/backup/portable-data.js:1330: Restore ersetzt Tabellen komplett (DELETE FROM + Neuinsert) → neue office-json-Schlüssel automatisch auch in der Wiederherstellung
- server/src/modules/backup/runner.js:735: runTotalBackup: gesamt-backup.sh mit SQLite-DB, runtime/data (inkl. Dokumentenspeicher-Bytes) und App-Datei
- server/src/modules/office/json-routes.js:28: KEYS-Whitelist — neuer office-json-Schlüssel muss hier eingetragen werden, sonst GET/PUT 404 (Z. 199–200, 212–213); 15-MB-Deckel Z. 231–232