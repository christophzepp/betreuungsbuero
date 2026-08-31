# Befund: Was ein zur Laufzeit registriertes Eigenformular vollwertig braucht

## Kurzfazit

Die Engine ist fast vollständig datengetrieben: **Pflicht sind genau zwei Einträge — ein `REPORTS`-Katalogeintrag und ein `SCHEMAS[id]`-Schema — registriert NACH dem V159-splice (Zeile 28958) und nach `REPORT_GROUPS.splice` (Zeile 28995), gefolgt von `ensureState()` + `buildNav()`.** Alles Weitere (Seitenleiste, Prozentanzeige, state-Anlage, Rendern, Pflichtfelder, KI-Prompts, Exportdialog, Dateinamen, Betreff-Editor, ⓘ-Dialog) speist sich generisch aus diesen beiden Quellen. Sonderbehandlung ist nur für eigene Feldtypen, eigene Gruppen und einen optionalen Originalvorlagen-Export nötig. Das vollständigste Vorbild ist die Housing/Notice-Registrierung im Block `mode-intro-script-v1`.

## Die drei Vorbilder

**(a) court_approval** (`v15900-document-library`, Z. 28963): Der V159-splice `REPORTS.splice(0,REPORTS.length,...V159.catalog...)` (Z. 28958) **verwirft alles, was nicht im Katalog steht** — deshalb wird court_approval unmittelbar danach wieder eingefügt (Dedupe-Check `!REPORTS.some(...)`, Einsortierung per `splice(ci,0,e)` vor `closing`, Gruppe vom Nachbarn geerbt). Gleiche Konsequenz gilt für `REPORT_GROUPS.splice(0,...)` (Z. 28995): **eigene Gruppen müssen nach Z. 28995 registriert werden.**

**(b) housingDefinition / NOTICE_ID** (`mode-intro-script-v1`, IIFE ab Z. 116700): Das Komplett-Vorbild — `REPORTS.push` mit Dedupe (Z. 116750 f.), `SCHEMAS[...]` (Z. 116766/116872), seedReport-Wrapper für Tabellen-Vorbelegung (Z. 116907–116919), renderField-Wrapper für den eigenen Typ `housingTable` (Z. 116922–116931), renderReportHeader-Wrapper (Z. 116938–116948), `OFFICIAL_PDF_TEMPLATES[NOTICE_ID]` mit `mode:'generated'` + createOfficialPdf/Diagnostics-Wrapper (Z. 116950–117076), getExportOptions-Wrapper (Z. 116956–116972), Abschluss mit `ensureState()` + `buildNav()` inkl. DOMContentLoaded-Fallback (Z. 117077–117085).

**(c) SCHEMAS-Zuweisungen**: Kernliteral Z. 4909 ff.; `V159.flatSchemas`-Loop Z. 28996 (nur `if(!SCHEMAS[id])`); Briefschemata Z. 29054; Housing/Notice Z. 116766/116872. Ein Schema ist `{sections:[{title,fields:[{id,label,type,required,min,full,options,sourcePath,combo,ai,hint,aliases,...}]}]}`.

## Integrationspunkte im Einzelnen

| Punkt | Generisch? | Details |
|---|---|---|
| **Seitenleiste/Gruppen** | Ja | `navGroupsHTML`/`v159ReportRows` (Z. 29290–29299) rendern REPORTS je `group` plus max. zweistufige Untergruppen. `REPORT_GROUPS`-Eintrag: `{id,title}`, Untergruppe zusätzlich `parent:'<topId>'`. Leere Gruppen werden mitgerendert. Eigene Gruppe: nach Z. 28995 pushen (Vorbild `buerodocs-script-v1` Z. 71301). |
| **Dokument-Kürzel (icon)** | Ja | Kommt direkt aus `r.icon` des REPORTS-Eintrags. `V159_DOCUMENT_ABBREVIATIONS` (Z. 28966–28990) überschreibt nur bekannte ids — Eigenformular setzt sein Kürzel selbst, kein weiteres Register nötig. |
| **state.reports-Anlage** | Ja | `ensureState()` (Kernblock Z. 5510) legt je REPORTS-Eintrag `{fields:{},meta:{}}` an; `openReport` (Z. 7118) ruft bei jedem Öffnen `ensureState()+seedReport(id)`, `enterWorkspace→seedAllReports` (Z. 6315) beim Arbeitsbereich-Einstieg. `seedReport` (Z. 6355) füllt generisch über `masterAutoValue`/`sourcePath` (Z. 6337). Einzelne Feld-Entries entstehen lazy; nur eigene Tabellentypen brauchen Vorbelegung wie Z. 116907 ff. `normalizeState` (Z. 5504) löscht unbekannte report-Keys NICHT — Daten überleben ein De-Registrieren. |
| **renderReport/renderField** | Ja, mit einer Falle | `renderReport` (Z. 7122) greift ungeprüft auf `SCHEMAS[currentReport].sections` zu — **ohne Schema Absturz beim Öffnen**, REPORTS-Eintrag allein reicht nicht. Wirksames Basis-`renderField` ist die Zweitdefinition Z. 8232 (gleicher Kernblock): text/textarea/select/checks/date/number/richtext + Spezialtabellen. Eigene Typen: Wrapper-Kette wie `assetInventoryTable` (Z. 29286–29288) bzw. `housingTable` (Z. 116922–116931). |
| **getExportOptions unbekannte id** | Ja | Z. 6550: Defaults print/letterhead/combined = an, original = aus, `originalTemplateReady` nur bei `OFFICIAL_PDF_TEMPLATES[id]?.ready`. Sonderfälle sind fest verdrahtete id-Listen plus `dokOhneOriginalvorlage` (Z. 6543, `group==='buero'` → kein Original). `DOC_EXPORT_DEFAULTS_V260` (Z. 6534) optional. Exportdialog (`openExportDialog` Z. 7891) und `getDocumentOptions` (Z. 6438, Signaturen) sind generisch mit lazy `state.ui.exportOptions/documentOptions[id]`. |
| **exportBaseName/Dateinamen** | Ja | `exportBaseName` (Z. 7923) baut aus `d.title`. Die Vorlagen-Engine `export-name-templates-v1` (ab Z. 36564) erkennt Editor-Exporte über die generischen DEFS `reportPdf`/`reportZip` (Regex `^(\d{6}) (\d{4}) (.+)\.pdf$`, Z. ~36656 ff.) — kein Katalogeintrag je Dokument nötig. |
| **Betreff-Editor** | Ja | `betreffEditorEinbauen` (Z. 37204) hängt sich per Wrapper um `showDocumentInfo` (Z. 37246–37256) — greift für JEDE id. Vorlagen je Dokument über `ui_prefs.subjectTemplates[id]` / `bueroLocal.subjectTemplates[id]` (Z. 37032–37034) funktionieren mit beliebigen ids; DOKUMENT-Baustein löst sich aus dem REPORTS-Titel. |
| **KI-Felder** | Ja | `createPrompt` (Z. 7378) + `openQuestions` (Z. 7366) + `aiSupportedField` (Z. 7348) + `aiFieldInstruction` (Z. 7349): jedes leere text/textarea/select/checks/date/number-Feld wird automatisch KI-Frage — `ai:true` ist NICHT Voraussetzung, es erzwingt nur die Stichpunkt-Box auch bei Nicht-Textareas (`fieldSupportsPromptNotes` Z. 7139). KI-Werkbank (`aiWorkbenchHTML` Z. 9808/10006) generisch. |
| **Pflichtfeld-Prüfung** | Ja | `validateReport` (Z. 7328) generisch über `required`/`min`; `reportCompletion` (Z. 7117) speist die %-Anzeige in der Seitenleiste — ohne ein einziges `required`-Feld steht dort dauerhaft 0 %. |
| **showDocumentInfo ohne OFFICIAL_PDF_TEMPLATES** | Ja | Z. 6753: `tplCfg` ist optional — ohne Eintrag fehlt nur der Vorlagen-Download, die Originalvorlage-Checkbox ist ausgegraut (`!OFFICIAL_PDF_TEMPLATES[id]?.ready`), Positionsprobe nur bei `OFFICIAL_COORDINATE_MAPS[id]` (Z. 7462). Metadaten (Vorlage/Stand/Urheber/Stelle/Quelle) kommen aus dem REPORTS-Eintrag — dort also sinnvolle Werte setzen. |
| **Druck/Briefkopf/Kombi-Export** | Ja | `unified-document-print-layout-v230` (Z. 118484 ff.) rendert jedes Nicht-Frei-/Nicht-Original-Dokument generisch aus SCHEMAS; Briefkopf-Weg fällt für Nicht-`V159_LETTERS`-ids auf den generischen Renderer zurück (Z. 29542). |

## Randfälle

- `openReport` (Z. 7118) verweigert unbekannte ids — nach dem Löschen eines Eigenformulars bleibt `state.reports` erhalten, das Dokument ist nur unsichtbar.
- Außendienst-Dateien (`aussendienst-2b-v1`, Z. 92380) filtern REPORTS auf die beim Erzeugen mitgenommene Liste `kopf.dokumente` — Eigenformulare sind enthalten, wenn sie beim Packen registriert waren.
- Spätere Blöcke sortieren einzelne ids per Index um (Z. 118054 ff., 119263 ff., 119516 ff.) — tolerant gegenüber zusätzlichen Einträgen.

## Wohin mit dem neuen Laufzeitteil (kein neuer Block!)

**Empfehlung: in den bestehenden Block `mode-intro-script-v1` (Z. 116329–117086), in die Registrierungs-IIFE ab Z. 116700 — konkret nach den Housing/Notice-Wrappern und vor dem abschließenden `ensureState()`/`buildNav()` (Z. 117077–117085).** Gründe: (1) sicher nach V159-splice (Z. 28958) und `REPORT_GROUPS.splice` (Z. 28995); (2) alle zu wrappenden Funktionen (renderField-Kette, seedReport, getExportOptions, createOfficialPdf) liegen dort bereits in ihrer Endfassung; (3) `bueroLocal` (Block `buero-local-mode-script-v1`, Z. 53932) ist als lokaler Speicher schon geladen; (4) das vorhandene `ensureState()+buildNav()`-Finale nimmt die neuen Dokumente automatisch mit — alles läuft synchron vor dem ersten Render (DOMContentLoaded, u. a. Z. 9157 `buildStartNav`).

Alternative (nur falls die Registrierung VOR den Zwischen-Wrappern liegen soll): `v15900-document-library` direkt hinter dem Abschnitt Katalog/Gruppen/Schemata/Registry (Z. 28995–29001), nach dem court_approval-Muster — fachlich nicht nötig, da alle späteren Wrapper Dedupe-/id-Checks haben.

Wichtig für den Formulareditor selbst: Die Registrierung als idempotente Funktion bauen (z. B. `window.__eigenformulareRegistrieren()`: je Definition `REPORTS`-Push mit Dedupe + `SCHEMAS[id]=`, danach `ensureState(); saveState(); buildNav();` und `renderReport()` falls das Dokument offen ist). Im Online-Modus kommt der büroweite Speicher (`office_json`, vgl. `ui_prefs`-Muster Z. 72782 ff.) asynchron an — dieselbe Funktion dann aus dem Sync-Callback erneut aufrufen; nur lokale Speicherung (`bueroLocal`/localStorage) ist zum Parse-Zeitpunkt synchron lesbar.

## Codestellen
- Kernblock (unbenanntes <script>, Z. 4829–10171), Z. 4856/4878/4909: REPORTS-Array, REPORT_GROUPS ({id,title}[,parent]) und SCHEMAS-Literal — die drei Datenquellen, aus denen fast alles generisch gespeist wird
- v15900-document-library, Z. 28958: V159-splice: REPORTS wird komplett durch V159.catalog ersetzt — verwirft alles, was nicht im Katalog steht; Eigenformulare zwingend erst danach registrieren
- v15900-document-library, Z. 28963: Vorbild (a): court_approval-Wiedereinfügung mit Dedupe-Check, Einsortierung vor 'closing', Gruppe vom Nachbarn geerbt
- v15900-document-library, Z. 28966–28990: V159_DOCUMENT_ABBREVIATIONS: sprechende Kürzel nur für bekannte ids — Eigenformular setzt sein icon selbst im REPORTS-Eintrag
- v15900-document-library, Z. 28995–29001: REPORT_GROUPS.splice(0,...,V159.groups) (eigene Gruppen erst danach pushen), SCHEMAS-Befüllung aus flatSchemas, OFFICIAL_TEMPLATE_REGISTRY-Merge — alternativer Registrierungsanker
- v15900-document-library, Z. 29218–29267: v159-seedReport-Wrapper (Vorbild für dokumentspezifische Nachbefüllung); Z. 29286–29288 renderField-Wrapper für Eigentyp assetInventoryTable
- v15900-document-library, Z. 29290–29305: v159ReportRows/navGroupsHTML: Seitenleiste rendert generisch aus REPORTS+REPORT_GROUPS (zweistufig, icon, reportCompletion-%)
- mode-intro-script-v1, Z. 116700–117086: Vorbild (b) und EMPFOHLENER Einbauort: komplette Laufzeit-Registrierung (REPORTS.push Z. 116750f., SCHEMAS Z. 116766/116872, seedReport-Wrapper Z. 116907–116919, renderField-Wrapper Z. 116922–116931, OFFICIAL_PDF_TEMPLATES[NOTICE_ID] Z. 116950, getExportOptions-Wrapper Z. 116956–116972, Abschluss ensureState()+buildNav() Z. 117077–117085)
- Kernblock, Z. 5510: ensureState(): legt je REPORTS-Eintrag state.reports[id]={fields:{},meta:{}} an — die ensure-Funktion für die state-Anlage
- Kernblock, Z. 6355 + 6337: seedReport + masterAutoValue: generische Stammdaten-Vorbefüllung über field.sourcePath
- Kernblock, Z. 6550 + 6543: getExportOptions: generische Defaults für unbekannte ids (Original aus, außer OFFICIAL_PDF_TEMPLATES[id].ready); dokOhneOriginalvorlage sperrt group 'buero'
- Kernblock, Z. 6753: showDocumentInfo: funktioniert ohne OFFICIAL_PDF_TEMPLATES-Eintrag (Checkbox ausgegraut, kein Download/Positionsprobe); Metadaten aus dem REPORTS-Eintrag
- Kernblock, Z. 7118 + 7122 + 8232: openReport (Guard: nur registrierte ids; ruft ensureState+seedReport) und renderReport — greift UNGEPRÜFT auf SCHEMAS[currentReport].sections zu (ohne Schema Absturz); wirksames Basis-renderField ist die Zweitdefinition Z. 8232
- Kernblock, Z. 7328 + 7117: validateReport (Pflicht/min-Prüfung) und reportCompletion (Seitenleisten-%) — generisch; ohne required-Felder dauerhaft 0 %
- Kernblock, Z. 7348–7378 + 7139: KI: aiSupportedField/openQuestions/aiFieldInstruction/createPrompt bauen Prompts generisch aus SCHEMAS; ai:true erzwingt nur die Stichpunkt-Box bei Nicht-Textareas
- Kernblock, Z. 7923: exportBaseName: Dateiname generisch aus REPORTS-Titel (JJMMTT HHMM Person [Empfänger] Titel)
- export-name-templates-v1, Z. 36564 + ~36656 + 37204–37256: Dateinamen-Engine (generische DEFS reportPdf/reportZip decken jeden Editor-Export ab) und Betreff-Editor (Wrapper um showDocumentInfo, greift für jede id; subjectTemplates per id)
- aussendienst-2b-v1, Z. 92380: Randfall: Außendienst-Dateien filtern REPORTS auf kopf.dokumente — Eigenformulare nur enthalten, wenn beim Packen registriert
- ui-feinheiten-v162, Z. 72782 ff.: ui_prefs/office_json wird asynchron per fetch geladen — büroweit gespeicherte Eigenformulare brauchen eine idempotente Nachregistrierung (erneut ensureState+buildNav) im Sync-Callback