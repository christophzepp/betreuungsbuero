# Testrisiken eines Laufzeit-Formulareditors (REPORTS/SCHEMAS-Injektion)

## (1) Tests, die Katalogzahl, Blockzahlen, REPORTS-Inhalte oder SCHEMAS-Strukturen pinnen

### A. Blockzahl-Pins (309 Blöcke / 229 JS) — nur statische Auswertung + Syntax-Kompilat
Elf Testdateien zählen die `<script>`-Blöcke per Regex über die Rohdatei und kompilieren jeden JS-Block einzeln mit `new vm.Script(...)` — **ohne ihn auszuführen**. Ein zusätzlicher `fetch` im Code ist hier harmlos; gefährlich sind nur: Blockzahl-Änderung, Syntaxfehler, top-level `await` (im klassischen Script ein Syntaxfehler) und **String-Literale mit `<script`/`</script`** (die Zähl-Regex scannt die Rohdatei, ein solches Literal verschiebt die Blockzählung):

- html-case-id-integration.test.cjs:28 (309) und :40 (229)
- html-online-case-load-priority.test.cjs:37/:44
- html-final-audit-patch.test.cjs:30/:37
- html-desktop-view-lock.test.cjs:14/:21
- html-no-module-folder.test.cjs:30
- html-calendar-todo-case-context.test.cjs:14/:21
- html-dashboard-widgets.test.cjs:83/:90
- html-addressbook-dark-mode.test.cjs:38/:45
- html-case-file-finance-dark-mode.test.cjs:97/:104
- html-documents-dark-mode.test.cjs:56/:63
- html-mail-dark-mode.test.cjs:53/:60

(Die Dateien html-real-folders-patch.cjs, html-storage-maintenance-patch.cjs, html-year-folder-patch.cjs zählen ebenfalls, sind aber Werkzeuge, keine Tests — der Runner greift nur `tests/*.test.js tests/*.test.cjs`, server/package.json:10.)

### B. Katalog-Pins (V159-Zeile, 83 Einträge)
- html-document-curation.test.cjs:23 — `v159.catalog.length === 83`; :24 verbietet `<script`-Sequenzen in der JSON-Zeile. Solange der Editor **nie in die V159-Zeile persistiert**, bleibt das grün.
- html-dokumenteigenschaften-2026-08.test.cjs:34–47 (einheitliche `templateDate`-Schreibweise über ALLE Katalogeinträge) und :79–82 („Jedes Dokument hat eine Stand-Auskunft") — iterieren nur über die statischen 83; Laufzeit-Dokumente sind unsichtbar. Bricht nur, wenn Editor-Dokumente doch in die V159-Zeile geschrieben würden.
- html-vorlagen-2026-08.test.cjs:19–21 parst die V159-Zeile, :26–45 pinnt konkrete Einträge, :49–57 die `OFFICIAL_COORDINATE_MAPS`-Formatierung, :60–70 liest den **statischen `const SCHEMAS={`-Block textuell** (Marker `\n{id}:{sections:[` und `\n]},\n`). Ein zweites Vorkommen von `const SCHEMAS={` oder Formatänderungen im Block brechen die Extraktion.

### C. REPORTS-/SCHEMAS-Struktur als statische Regex-Pins (brechen nur bei Umformulierung bestehenden Codes, nicht durch Laufzeit-Injektion)
- html-care-application-caregiver-document.test.cjs:24–25 (`REPORTS.findIndex`/`splice`-Muster)
- html-care-change-caregiver-document.test.cjs:16–19, :39 (`SCHEMAS[ID]={sections:[{`)
- html-care-change-person-fields.test.cjs:16–23
- html-free-document-subject-export.test.cjs:18 (`REPORTS.find(...)`)
- html-field-service-document-selection.test.cjs:80–82 — der Außendienst-Loader `aussendienst-2b-v1` macht `REPORTS.splice(0,REPORTS.length,...REPORTS.filter...)` und `currentReport=REPORTS[0]`. **Achtung:** Wenn der Formulareditor die Listen-Erzeugung/Filterung umbaut, brechen diese Muster; außerdem muss geklärt sein, ob Editor-Dokumente den Außendienst-Filter überleben sollen.
- html-new-document-templates.test.cjs:16–19 (REPORTS-Eintrags-Literale), html-document-curation.test.cjs:85–92 (Kernschema-Feldliterale) und :95–101 (Laufzeitblock 2.41, `OFFICIAL_PDF_TEMPLATES`), html-doku-report-targets.test.cjs (Zielfeld-Literale).

### D. vm-ausführende Tests — und die fetch-Frage
Die vm-Tests führen **nie die ganze App** aus, sondern gezielt einzelne Blöcke (per `scriptById`, das Eindeutigkeit der Block-ID erzwingt, z. B. html-online-case-load-priority.test.cjs:22) oder Marker-Regionen (per `between`/`region` mit Eindeutigkeits-Assert der Startmarke, html-case-id-integration.test.cjs:17–18). Der Kernblock mit `const REPORTS=[` (HTML Zeile 4856) und `const SCHEMAS={` (Zeile 4908) ist ein `<script>` **ohne id** (Zeile 4829) — **kein Test führt ihn aus**. Dort eingehängter Editor-Code wird nur syntaxgeprüft.

fetch/window werden **nur dort gestubbt, wo der jeweils ausgeführte Block sie braucht** — es gibt keinen globalen Stub. Ein zusätzlicher fetch beim Laden bricht vm-Tests also genau dann, wenn der Code in einem dieser Blöcke landet:
- html-online-case-load-priority.test.cjs:48–89 — führt `app-login-ready-replay-script-v1` aus, stubbt `window.fetch`, und pinnt die Aufrufliste **exakt** per `deepEqual` (:79, :84, :88). Ein Editor-fetch in diesem Block bricht den Test sicher. (Fachlich relevant: dieser Block installiert die Online-Boot-Schranke — ein Nachlade-fetch des Editors wird zur Laufzeit ohnehin hinter die Fallfreigabe gestellt.)
- html-central-institution-combo.test.cjs:135–190 — führt `stammdaten-suggest-v160` + `suggestion-registry-v1` mit fetch/localStorage/document-Stubs aus; :215–216 pinnt **genau 1** fetch auf `/api/office-json/suggestion_registry`. Jeder zusätzliche fetch in diesen Blöcken bricht ihn.
- html-housing-suggestion-registry.test.cjs:142–208, :398–400 — gleiches Muster, `fetchCalls.length === 1`.
- html-dashboard-widgets.test.cjs:102–145 — führt `dashboard-script-v1` komplett aus; fetch-Stub antwortet generisch, Asserts prüfen nur Vorhandensein (:217, :309) — tolerant gegenüber Zusatzaufrufen.
- html-care-notice-document-info.test.cjs:13–49 — führt die Region `care-notice-document-defaults-v247-start/end` mit REPORTS-Stub (`[{id:'letter_care_notice'}]`), window/document-Stubs, aber **ohne fetch** aus — ein fetch dort würde werfen. Gutes Vorbild für Editor-Tests.
- html-case-id-integration.test.cjs:45–56 — führt nur die pure Funktion `caseRefMatchCore` in leerem Kontext aus (kein window/fetch nötig). Zusätzliche fetches brechen diesen Test nicht; wohl aber **doppelte Markerstrings** (z. B. ein zweites `function caseRefRecords(extra){` → „Startmarke nicht eindeutig", :18).
- Gleiches Ausführungsmuster (scriptById + Minimalkontext): html-system-combo-consumer-migration.test.cjs:112–114, html-house-number-combo-migration.test.cjs:226–373, html-combo-remaining-consumers.test.cjs:124–125, html-combo-audit-regressions.test.cjs:147–172, html-housing-individual-entries.test.cjs:108 und html-housing-report-period-sync.test.cjs:155 (`initial-data-domains-script-v255`), html-master-zusatzblaetter.test.cjs:33, html-functional-profile-hub.test.cjs:90, html-field-service-document-selection.test.cjs:44–52, html-document-taxonomy.test.cjs:13–33 (führt `ogBuildBaseline` aus und pinnt die 13 Basisordner 00–12 — relevant, falls Editor-Dokumente eigene Ablage-Kategorien anlegen sollen).

**Praktische Ableitung:** Editor-Code in den id-losen Kernblock (oder einen anderen nicht-ausgeführten Block) legen, keine Markerstrings der `between`/`region`-Helfer duplizieren (`const SCHEMAS={`, `const GROUPS=[`, `window.__runtimeMode=function(){`, `function caseRefRecords(extra){` …), keine `<script`-Literale, kein top-level await — dann bleiben alle bestehenden Tests grün.

## (2) Zählt ein Test die Dokumentliste/Seitenleiste?
**Nein.** Kein Test pinnt die Zahl 89 oder zählt REPORTS-/Sidebar-Einträge. Am nächsten dran:
- html-vorlagen-2026-08.test.cjs:40 — Seitenleisten-Kürzel je neuer Dokument-ID als String-Include (`${id}:'EAK'`), keine Zählung.
- html-field-service-document-selection.test.cjs:25–38 — Dokumentauswahl-UI per Regex (`dokumenteLesen()`, „Alle auswählen"), keine Zählung.
- html-functional-profile-hub.test.cjs:25–30 und html-initial-data-domains-v255.test.cjs:168–169 — prüfen Reihenfolge in `GROUPS` (HTML Zeile 26472), das ist die **Modul-Seitenleiste der Fallakte**, nicht die Dokumentliste.

## (3) Skizze: Tests für den Formulareditor
1. **Injektions-Vertrag (vm, Vorbild html-care-notice-document-info):** Editor-Registrierungsfunktion als markierte Region mit eindeutigen Markern bauen und im Minimalkontext (REPORTS/SCHEMAS-Stubs, buildNav/saveState-Zähler) ausführen: eigenes Dokument landet hinter den eingebauten Einträgen, `SCHEMAS[id]` wird gesetzt, `buildNav`/`renderReport` werden angestoßen, ID-Kollisionen mit Katalog-IDs werden abgewiesen (z. B. Pflicht-Präfix `custom_`).
2. **Persistenz-Invariante:** Editor speichert nur in localStorage/office-json — Test bestätigt, dass die V159-Zeile und der statische SCHEMAS-Block der Datei unverändert bleiben (Katalog 83, keine Schreibpfade in die Zeile); sichert die Grenze zu html-document-curation/dokumenteigenschaften dauerhaft ab.
3. **fetch-Disziplin (Vorbild html-online-case-load-priority bzw. html-central-institution-combo:215):** Falls Definitionen vom Server kommen (`/api/office-json/form_documents` o. ä.): genau ein Ladeaufruf, `credentials:'same-origin'`, und der Abruf respektiert die Boot-Schranke (kein optionaler GET vor Fallfreigabe).
4. **CRUD pur (Vorbild caseRefMatchCore):** Abschnitt/Feld anlegen, umbenennen, löschen und Feld-ID-/Typ-Validierung als extrahierbare pure Funktionen, per `between()` im vm getestet.
5. **Lösch-/Rückbau:** Löschen eines Editor-Dokuments entfernt REPORTS/SCHEMAS-Eintrag zur Laufzeit, eingebaute Dokumente bleiben unberührt, `currentReport` fällt auf ein existierendes Dokument zurück; Archivstände gelöschter Editor-Dokumente bleiben lesbar oder werden definiert behandelt.
6. **Außendienst/Export-Integration:** Editor-Dokumente erscheinen in `dokumenteLesen()` (aussendienst-1-v1) und überleben (oder fallen definiert aus) den REPORTS-Filter des Loaders `aussendienst-2b-v1` — als Erweiterung von html-field-service-document-selection.
7. **Taxonomie/Gruppen:** Eigene Dokumente dürfen nur existierende `cat_XX`-Gruppen wählen; die Basisordner aus `ogBuildBaseline` (html-document-taxonomy) bleiben unverändert.

Die Einhaltung von 309/229 erzwingen die elf Zähltests bereits — dafür braucht es keinen neuen Test, nur die Regel: Code in bestehende Blöcke, keine `<script`-Literale.

## Codestellen
- server/tests/html-document-curation.test.cjs:23: Pinnt v159.catalog.length === 83; Zeile 24 verbietet <script>-Sequenzen in der V159-JSON-Zeile
- server/tests/html-case-id-integration.test.cjs:28: Pinnt 309 Scriptblöcke und 229 JS-Blöcke (Zeile 40); kompiliert jeden Block einzeln mit new vm.Script (Syntax, keine Ausführung); between()-Helfer (Zeile 17-18) erzwingt Eindeutigkeit der Markerstrings; führt nur die pure Funktion caseRefMatchCore aus (Zeile 45-56, leerer Kontext, kein fetch/window nötig)
- server/tests/html-online-case-load-priority.test.cjs:37: Pinnt 309/229 (Zeile 44); führt Block app-login-ready-replay-script-v1 mit window.fetch-Stub aus und pinnt die fetch-Aufrufliste exakt per deepEqual (Zeilen 79/84/88) — zusätzlicher fetch in diesem Block bricht den Test
- server/tests/html-central-institution-combo.test.cjs:215: Führt stammdaten-suggest-v160 + suggestion-registry-v1 im vm aus (fetch/localStorage/document gestubbt, Zeilen 135-190) und pinnt fetchCalls.length === 1 auf /api/office-json/suggestion_registry
- server/tests/html-housing-suggestion-registry.test.cjs:398: Gleiches Muster: führt Registry-Blöcke im vm aus, pinnt genau einen fetch auf /api/office-json/suggestion_registry (Kontextaufbau Zeilen 142-208)
- server/tests/html-dashboard-widgets.test.cjs:83: Pinnt 309/229 (Zeile 90); führt dashboard-script-v1 komplett mit fetch-Stub aus (Zeilen 102-145), prüft aber nur Vorhandensein bestimmter Aufrufe (Zeilen 217/309) — tolerant gegenüber Zusatz-fetches
- server/tests/html-care-notice-document-info.test.cjs:13: Führt Region care-notice-document-defaults-v247-start/end im vm aus mit REPORTS-Stub, window/document-Stubs, aber OHNE fetch-Stub — Vorbild für Formulareditor-Injektionstests
- server/tests/html-field-service-document-selection.test.cjs:80: Pinnt im Außendienst-Loader aussendienst-2b-v1 das Muster REPORTS.splice(0,REPORTS.length,...REPORTS.filter...) und currentReport=REPORTS[0] (Zeile 82); Zeilen 25-38 prüfen dokumenteLesen()/Dokumentauswahl-UI per Regex
- server/tests/html-vorlagen-2026-08.test.cjs:60: Liest den statischen 'const SCHEMAS={'-Block textuell (Marker \n{id}:{sections:[ und \n]},\n) — ein zweites Vorkommen von 'const SCHEMAS={' oder Formatänderung bricht die Extraktion; Zeile 40 prüft Seitenleisten-Kürzel je ID als String-Include (keine Zählung)
- server/tests/html-dokumenteigenschaften-2026-08.test.cjs:79: 'Jedes Dokument hat eine Stand-Auskunft' und einheitliche templateDate-Schreibweise (Zeilen 34-47) — iteriert über alle 83 statischen Katalogeinträge; bricht nur bei Persistenz in die V159-Zeile
- server/tests/html-final-audit-patch.test.cjs:30: Pinnt 309/229 (Zeile 37) plus doesNotMatch/match-Belege über die gesamte HTML
- server/tests/html-document-taxonomy.test.cjs:13: Extrahiert und FÜHRT ogBuildBaseline im vm AUS; pinnt die 13 Basisordnernamen 00-Eingang bis 12-Abschluss — relevant, falls Editor-Dokumente eigene Ablage-Kategorien bekommen sollen
- server/tests/html-care-application-caregiver-document.test.cjs:24: Statische Regex-Pins auf REPORTS.findIndex/splice-Einfügemuster; ebenso html-care-change-caregiver-document.test.cjs:16-19,39 (SCHEMAS[ID]={sections:[{) und html-care-change-person-fields.test.cjs:16-23
- server/tests/html-desktop-view-lock.test.cjs:14: Pinnt 309/229 (Zeile 21); weitere identische Zahl-Pins: html-no-module-folder.test.cjs:30, html-calendar-todo-case-context.test.cjs:14/21, html-addressbook-dark-mode.test.cjs:38/45, html-case-file-finance-dark-mode.test.cjs:97/104, html-documents-dark-mode.test.cjs:56/63, html-mail-dark-mode.test.cjs:53/60
- server/tests/html-initial-data-domains-v255.test.cjs:168: Extrahiert 'const GROUPS=[' per erstem indexOf und prüft Reihenfolge der Modul-Seitenleiste (Fallakte) — keine Dokumentlisten-Zählung; ebenso html-functional-profile-hub.test.cjs:25-30
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:4829: Der Kernblock mit const REPORTS=[ (Zeile 4856) und const SCHEMAS={ (Zeile 4908) ist ein <script> ohne id — kein vm-Test führt ihn aus; dort eingehängter Editor-Code wird nur syntaxgeprüft. GROUPS steht in Zeile 26472
- server/package.json:10: Testrunner: node --test tests/*.test.js tests/*.test.cjs — html-real-folders-patch.cjs, html-storage-maintenance-patch.cjs, html-year-folder-patch.cjs sind Werkzeuge, keine Tests