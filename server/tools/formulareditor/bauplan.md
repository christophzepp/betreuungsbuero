# Bauplan Formulareditor

Stand 24.08.2026. Grundlage: fünf Erkundungsberichte in `erkundung/` (Codestellen dort mit
Datei:Zeile), Mockup in `mockups/formulareditor-mockup-v1.html` (Entwurf 1, drei Ansichten).

## Zielbild und getroffene Entscheidungen

Ein Bereich **„Formulare"** im Admin-Panel, mit dem das Büro eigene Dokumente als Baukasten
anlegt, bearbeitet und löscht. Eigene Formulare verhalten sich überall wie mitgelieferte:
Seitenleiste, Prozentanzeige, KI-Werkbank, Betreff-Editor, Exportdialog, Dateinamen.

Mit dem Nutzer abgestimmt (24.08.2026):

| Frage | Entscheidung |
|---|---|
| Speicherort | **Drei Modi:** Online auf dem Server; Lokalmodus (file://) in der HTML eingebettet; Außendienstdatei in der HTML eingebettet, dort mit der bestehenden An-/Abwahl je Dokument |
| Mitgelieferte Dokumente | **Kopieren und Ausblenden** — nie direkt bearbeiten oder löschen |
| Original-PDF | **Gleich im ersten Wurf**: Hochladen + Positionszuordnung |
| Baukasten | Grundbausteine **plus Tabellen** mit frei benannten Spalten |

## 1. Datenmodell

Eine büroweite Sammlung `custom_forms` (JSON):

```json
{
  "version": 1,
  "forms": [{
    "id": "custom_pflb",                     // Pflicht-Präfix custom_, nie ein Katalog-id
    "katalog": {                              // wird 1:1 der REPORTS-Eintrag
      "id": "custom_pflb", "title": "Pflegebericht an die Pflegekasse",
      "icon": "PflB", "group": "cat_07_behinderung", "groupLabel": "…",
      "template": "--", "templateDate": "--", "pages": "dynamisch",
      "author": "Betreuungsbüro", "authority": "Pflegekasse",
      "sourceUrl": "", "sourceLabel": "", "templateKind": "custom"
    },
    "schema": { "sections": [ { "title": "…", "fields": [
      { "id": "custom_pflb_f01", "label": "…", "type": "text|textarea|select|checks|date|number|customTable",
        "required": true, "full": false, "hint": "", "ai": true,
        "sourcePath": "person.fullName",      // Vorbefüllung, Auswahlliste im Editor
        "options": ["…"],                     // select/checks
        "columns": [{"key":"c1","label":"…","type":"text|number|money"}] } ] } ] },
    "pdf": {                                  // nur wenn Original-PDF zugeordnet
      "dateiId": "…",                         // Verweis auf den PDF-Speicher, NIE Base64 hier
      "fileName": "…", "pages": 2,
      "karte": { "text": {…}, "checks": {…}, "tables": {…} },   // Format = OFFICIAL_COORDINATE_MAPS
      "ready": false                          // erst nach vollständiger Zuordnung + Testdruck
    },
    "geaendertAm": "…", "geaendertVon": "…"
  }],
  "hiddenBuiltins": ["broadcast_exemption_application"]
}
```

Feld-Kennungen werden automatisch vergeben und bleiben beim Umbenennen stabil, damit
gespeicherte Falldaten (state.reports) erhalten bleiben. Das Löschen eines Formulars löscht
keine Falldaten — `normalizeState` räumt unbekannte report-Schlüssel bewusst nicht ab
(Erkundung „laufzeitregistrierung", Randfälle).

## 2. Speicher- und Verteilwege (die drei Modi)

**Online:** `custom_forms` als neuer Schlüssel in der Whitelist `KEYS`
(server/src/modules/office/json-routes.js:28). Damit gratis: GET/PUT mit Rechteprüfung,
Echtzeit-Ereignis `officeJson` an alle offenen Fenster, automatische Aufnahme in
Vollsicherung, Moduldaten-Export/-Restore und lesbares Büroabbild (Erkundung
„server-speicher" Abschnitt 3 — der generische Tabellen-Dump nimmt neue Schlüssel ohne
Zutun mit). Schreiben verlangt wie ui_prefs `isAdmin || canManageOfficeProfile`.
**Der 15-MB-Deckel verbietet PDF-Bytes in dieser Sammlung** — dafür gibt es den PDF-Weg (Punkt 5).

**Lokalmodus und Außendienst:** Die Datei entsteht per `cloneNode` des statischen HTML —
Laufzeit-Registrierungen wandern NICHT mit (Erkundung „aussendienst" Abschnitt 1). Deshalb:

1. Beim Erzeugen wird `custom_forms` in die eingebettete Nutzlast aufgenommen — eigener
   Zweig in `bueroLesen()` (App ~Z. 91055, wo bereits kontaktmonitor/qualifikationen einzeln
   gefetcht werden), zugehörige PDF-Vorlagen als Base64 in die Nutzlast (analog dem
   bestehenden Nachladen geleerter Vorlagenblöcke, App ~Z. 91547).
2. Beim Öffnen registriert der Loader (`aussendienst-2b-v1`) die Eigenformulare **vor** dem
   `kopf.dokumente`-Filter (App Z. 92374) — der Filter übernimmt dann die vorhandene
   An-/Abwahl-Mechanik unverändert; `dokumenteLesen()` listet Eigenformulare automatisch.

## 3. Laufzeit-Registrierung in der App

Eine idempotente Funktion `__eigenformulareRegistrieren(sammlung)`:

- je Formular: REPORTS-Push mit Dedupe (Vorbild court_approval, Z. 28963) + `SCHEMAS[id]=…`
  — **immer paarweise**, denn `renderReport` stürzt ohne Schema (Z. 7122);
- eigene Gruppen erst NACH `REPORT_GROUPS.splice` (Z. 28995) einhängen;
- Ausblendliste anwenden (REPORTS filtern; `currentReport`-Fallback wie beim Löschen);
- danach `ensureState(); buildNav();` und `renderReport()` falls das Dokument offen ist.

**Einbauort:** bestehender Block `mode-intro-script-v1`, in die Registrierungs-IIFE nach den
Housing/Notice-Wrappern, vor deren abschließendem `ensureState()/buildNav()` (Z. 117077) —
dort liegen alle zu wrappenden Funktionen in Endfassung, und es läuft sicher nach dem
V159-splice (Erkundung „laufzeitregistrierung", Empfehlung). Der Online-Abruf kommt asynchron:
dieselbe Funktion läuft aus dem Sync-Callback erneut (Nachregistrierung), im Lokal-/
Außendienstmodus synchron aus der eingebetteten Nutzlast.

Alles Weitere ist laut Erkundung **generisch** und braucht keinen Eingriff: Seitenleiste,
state-Anlage, Stammdaten-Vorbefüllung über `sourcePath` (seedReport/masterAutoValue),
Pflichtfelder/Prozente, KI-Werkbank (jedes leere Feld wird automatisch KI-Frage),
Exportdialog-Defaults für unbekannte ids (Original aus, außer ready), Dateinamen-Engine,
Betreff-Editor, ⓘ-Dialog ohne OFFICIAL_PDF_TEMPLATES-Eintrag. Einzig der neue Feldtyp
`customTable` braucht einen renderField-Wrapper (Vorbild `housingTable`, Z. 116922) plus
Druck-/Beiblatt-Anbindung.

## 4. Die drei Ansichten (siehe Mockup)

Einstieg: neuer Tab **`forms` „Formulare"** in `ADMIN_NAV_GROUPS` Gruppe „Einstellungen"
(App Z. 37569), Dialogaufweitung nach dem Admin-Muster `#modal:has(.forms-shell)
.modal-box{width:min(1240px,97vw)}` (Vorbild Z. 37390). Optional ein Sidebar-Knopf nach dem
Vorbild „Online-Formulare" (Z. 59453).

1. **Verwaltung** — Liste aller Formulare (eigene + mitgelieferte + ausgeblendete), Suche,
   Filterchips, je Zeile Kürzel/Gruppe/Herkunft/Ausgabearten. Aktionen: eigene → Bearbeiten/
   Kopieren/Löschen; mitgelieferte → Kopieren/Ausblenden. Löschen mit Rückfrage und Hinweis,
   dass Falldaten erhalten bleiben.
2. **Baukasten** — dreispaltig: Struktur (Abschnitte + Felder, Palette mit 7 Bausteinen),
   lebende Vorschau im .paper-Stil (klickbar, mit source-badges), Eigenschaften rechts
   (Beschriftung, Art, Optionen bzw. Tabellenspalten, Stammdaten-Vorbefüllung als
   Auswahlliste, Pflicht, volle Breite, KI, Hinweis). Dokumentkopf: Titel, Kürzel, Gruppe,
   zuständige Stelle.
3. **PDF-Zuordnung** — links Seitenvorschau mit platzierbaren Ankern (grün = Stammdaten,
   rot = Formularfelder), rechts Feldliste mit Fortschritt und offen/zugeordnet. Werkzeuge:
   Seite, Vergrößerung, „Positionen prüfen (Testdruck)" — nutzt den vorhandenen
   `downloadCoordinateTestPdf(reportId)`.

## 5. Der PDF-Weg für Eigenformulare

Der bestehende Vorlagenweg kennt nur statisch eingebaute PDFs — `/api/pdf-vorlagen`
(404 für Fremdes) und `embeddedPdfBytes()` sucht ein DOM-Element (Erkundung „aussendienst"
Abschnitt 2). Nötig sind vier Stücke:

1. **Ablage:** hochgeladene PDF im Dokumentenspeicher-Muster als Bytes-Tabelle
   (Vorbild `intake_files` — Bytes ausdrücklich nicht in office_json), Route
   `/api/formular-vorlagen/:formId` (GET/PUT/DELETE, Rechte wie custom_forms-Schreiben).
2. **Nachschlag:** `embeddedPdfBytes()` um einen katalogbasierten Zweig erweitern: wenn die
   elementId zu einem Eigenformular gehört, von der neuen Route laden (Online) bzw. aus der
   eingebetteten Nutzlast lesen (Lokal/Außendienst).
3. **Karte:** die gespeicherte `pdf.karte` wird bei der Registrierung nach
   `OFFICIAL_COORDINATE_MAPS[id]` gehoben — damit greifen ALLE bestehenden Schutzregeln
   unverändert: ohne Karte gesperrt statt falsch befüllt, Überhang aufs Beiblatt,
   Auswahl ohne Kästchen bricht ab, Testdruck aus dem ⓘ-Dialog.
4. **Seitenvorschau:** für das Klick-Platzieren braucht der Browser einen PDF-Renderer.
   Die App hat nur pdf-lib (kein Rendering). **Entscheidung im Bau: pdf.js (legacy build)
   als eingebetteten Vendor in einen bestehenden Block aufnehmen** (~1,5 MB, lazy erst im
   Zuordnungseditor instanziiert). Das ist das größte Einzelstück und der einzige neue
   Fremdcode; Alternative (Zuordnung blind per Testdruck-Schleife) ist für Endnutzer nicht
   zumutbar und wird verworfen.

## 6. Kopieren und Ausblenden der Mitgelieferten

- **Kopieren:** erzeugt ein Eigenformular `custom_<id>_kopie` mit tiefem Klon des Schemas.
  Felder behalten ihre ursprünglichen Kennungen NICHT (neue custom_-Kennungen) — sonst
  kollidierten Falldaten desselben Falls zwischen Original und Kopie. Bestehende
  PDF-Zuordnung wird mitkopiert, wenn die Vorlage statisch eingebaut ist (elementId-Verweis
  bleibt gültig).
- **Ausblenden:** `hiddenBuiltins` wirkt nur auf die Laufzeitliste (Seitenleiste,
  Außendienst-Auswahl). Die V159-Zeile bleibt unangetastet; Goldstandards dürfen ausgeblendet,
  nie verändert werden. Archivstände ausgeblendeter Dokumente bleiben lesbar.

## 7. Leitplanken (aus der Testfallen-Erkundung)

1. **Blockzahl 309/229 bleibt:** aller Code wandert in bestehende Blöcke; **keine
   `<script`-Literale in Strings** (der Editor erzeugt HTML-Vorschauen — Templates escapen!),
   kein top-level await.
2. **Die V159-Zeile wird NIE beschrieben** (Katalog-Pin 83, Stand-Pflicht-Tests iterieren
   nur über die statischen Einträge). Eigenformulare existieren ausschließlich zur Laufzeit
   plus in `custom_forms`.
3. **Markerstrings nicht duplizieren:** kein zweites `const SCHEMAS={`, `const GROUPS=[`,
   `function caseRefRecords(extra){` u. ä. — die between()/region()-Helfer der Tests
   erzwingen Eindeutigkeit.
4. **fetch-Disziplin:** kein Lade-fetch in den Blöcken `app-login-ready-replay-script-v1`,
   `stammdaten-suggest-v160`, `suggestion-registry-v1` (Tests pinnen dort exakte
   Aufruflisten). Der custom_forms-Abruf hängt hinter der Boot-Schranke/Fallfreigabe.
5. **ids:** Pflicht-Präfix `custom_` für Dokumente und Felder; Gruppen nur aus bestehenden
   `cat_XX` oder eine neue eigene Gruppe — die Ablage-Basisordner (`ogBuildBaseline`,
   13 Ordner) bleiben unverändert.
6. **15-MB-Deckel:** keine PDF-Bytes in `custom_forms`.

## 8. Bauabschnitte

| # | Inhalt | Prüfstand |
|---|---|---|
| 1 | Server: Whitelist-Schlüssel `custom_forms` + Schreibrecht; App: Registrierungsfunktion im `mode-intro-script-v1` (Laden Online + eingebettet), Ausblendliste | Injektionsvertrag im vm (Vorbild care-notice-Test): Registrierung, Dedupe, Kollisionsabweisung, buildNav-Aufruf; Persistenz-Invariante V159-Zeile |
| 2 | Verwaltung (Admin-Tab `forms`): Liste, Suche, Filter, Löschen, Ausblenden/Einblenden | Statik-Test auf Tab + Aktionen; vm-Test Lösch-Rückbau (currentReport-Fallback) |
| 3 | Baukasten: Struktur/Vorschau/Eigenschaften, 6 Grundtypen + Stammdaten-Auswahl + KI-Schalter; Speichern nach `custom_forms` | CRUD pur als extrahierbare Funktionen (Feld-ID-Vergabe, Umbenennen ohne ID-Wechsel, Validierung) |
| 4 | Tabellenbaustein `customTable`: renderField-Wrapper, Eingabe, Druckweg, Beiblatt | vm-Render-Test + Druck-Schnappschuss |
| 5 | PDF-Weg: Upload-Route + Bytes-Ablage, embeddedPdfBytes-Zweig, pdf.js-Einbettung, Zuordnungseditor, Karte → OFFICIAL_COORDINATE_MAPS, ready-Schaltung | Positionsprobe je Beispielformular; Test: ohne vollständige Karte bleibt Original gesperrt |
| 6 | Kopieren der Mitgelieferten (inkl. statischer PDF-Verweis) | Test: Kopie kollidiert nicht, Original unverändert |
| 7 | Außendienst/Lokal: bueroLesen-Zweig, Nutzlast-Einbettung (Definitionen + PDF-Bytes), 2b-Registrierung vor dem Filter | Erweiterung von html-field-service-document-selection |

Reihenfolge ist verbindlich: 1→3 ergeben das erste nutzbare Ergebnis (eigene Formulare mit
Druck/Briefkopf/Anschreiben); 5 ist das größte Einzelstück und läuft erst, wenn der
Baukasten trägt; 7 zum Schluss, weil es alle Teile einbettet.

## Offene Punkte (klein, beim Bau zu entscheiden)

- Eigene Gruppe „Eigene Formulare" als Standard oder Einsortierung in bestehende Gruppen
  als Standard (Mockup zeigt: Gruppe frei wählbar, Standard eigene Gruppe).
- Rechte: dürfen alle mit `can_edit_cases` Formulare bauen oder nur
  `canManageOfficeProfile`? (Vorschlag: Bearbeiten nur Büroverwaltung, Nutzen alle.)
- pdf.js-Version und Einbettungsblock (Vendor-Block mit vorhandener pdf-lib naheliegend).

---

## Baustand

**Abschnitte 1–3 umgesetzt am 24.08.2026.** 561/561 Tests grün (9 neue in
`server/tests/html-formulareditor.test.cjs`, darunter die vm-Ausführung der
Registrierungsregion mit Minimalkontext).

Was wo liegt:

| Teil | Ort |
|---|---|
| Server-Freischaltung `custom_forms` + Schreibrecht (Büroverwaltung/Admin) | `server/src/modules/office/json-routes.js` (KEYS-Whitelist, PUT-Rechteprüfung) |
| Registrierung, Normalisierung, Feld-Kennungsvergabe, Speichern, Ladewege | App, Block `mode-intro-script-v1`, Region `formulareditor-registrierung-start/-ende` |
| Editor (Verwaltung + Baukasten), `window.__formulareditor` | App, gleiche IIFE, direkt danach |
| Admin-Tab `forms` (Nav, Icon, Erklärzeile, renderActiveTab-Zweig) | App, Block `admin-panel-script-v1` |
| CSS (`.cf-*`) | App, Style-Block `admin-panel-style-v2`, ans Ende angehängt |

Im Livetest bestätigt (Prüfserver, angemeldet): Formular anlegen → speichern (PUT 200) →
erscheint in Seitenleiste unter „Eigene Formulare" → öffnet als vollwertiges Dokument mit
Stammdaten-Vorbefüllung (Quelle „master"), Pflichtfeld-Prüfhinweisen und KI-Werkbank;
Exportdialog: Druck/Briefkopf/Anschreiben an, Original aus. Kopieren des Schlussberichts
erzeugt 14 Felder mit durchgehend neuen Kennungen. Ausblenden/Einblenden von
`broadcast_registration` im echten Lauf geprüft. Kennung wird beim ersten Speichern aus dem
endgültigen Titel abgeleitet und bleibt danach stabil.

Bekanntes geteiltes App-Verhalten (kein Editor-Fehler): Datumsfelder zeigen deutsch
formatierte Stammdatenwerte („14.03.1941") im HTML-Datumseingabefeld nicht an; der Wert ist
gespeichert und wird beim Export ausgegeben — identisch beim eingebauten Erweiterungsantrag.

Offen aus dem Plan: Abschnitte 4 (Tabellenbaustein), 5 (PDF-Weg + Zuordnungseditor),
6 ist teilweise vorweggenommen (Kopieren läuft bereits), 7 (Außendienst/Lokal-Einbettung).

## Adversarialer Review (24.08.2026) — 7 Befunde behoben

Ein Multi-Agent-Review (drei Blickwinkel: Einschleusung, Zustand, Wechselwirkung; jeder Befund
gegengeprüft) fand sieben echte Fehler, alle behoben und mit 8 Regressionstests abgesichert
(569/569 grün), die Angriffe zusätzlich im Livetest verifiziert:

| Schwere | Befund | Fix | Live-Beweis |
|---|---|---|---|
| hoch | `icon` roh in der Seitenleiste (`<span>${r.icon}</span>`) → gespeicherte XSS, auch per direktem PUT | beide Nav-Renderer escapen `esc(r.icon)`; zusätzlich saniert `__cfNormalisieren` alle Katalog-/Feld-Freitexte (entfernt `<>`, kappt Längen, icon auf 6) am Aufnahmepunkt | `<img onerror>` als Kürzel per PUT → 0 img-Elemente, kein Skript gefeuert |
| hoch | Zwei Fenster: veralteter Stand überschreibt beim PUT fremde Formulare | `__customFormsMutieren` = frisch GETen, mutieren, PUT (Read-Modify-Write); alle schreibenden Aktionen laufen darüber; zusätzlich Echtzeit-Listener auf das `officeJson`-Ereignis | A legt an, B blendet aus → A überlebt, B's Ausblendung auch |
| hoch | Außendienst: Eigenformulare vorausgewählt, fehlen aber in der Datei (Abschnitt 7 fehlt) | `dokumenteLesen()` schließt `custom_`-Formulare aus, bis die Einbettung steht | Test |
| mittel | Doppelklick auf Speichern → TypeError-Toast trotz Erfolg | Reentry-Guard `__speichertGerade`, Titel vor `await` gesichert | Test |
| mittel | ID-Wiederverwendung nach Löschen → neues Formular erbt fremde Falldaten (zwei Befunde) | `freieFormId` prüft zusätzlich `state.reports` und `SCHEMAS` (`idBelegt`) — gelöschte ids bleiben belegt | anlegen/ausfüllen/löschen/gleichnamig neu → neue Kennung `_2`, erbt keine Werte |
| mittel | Löschen macht Archivstände unrenderbar → leere PDF | Registrierungs-Rückbau behält `SCHEMAS[id]`, solange Falldaten existieren | nach Löschen `schemaDa:true` |

Der widerlegte Befund (`</script>`-Ausbruch beim Außendienst-Einbetten) betrifft ausschließlich den
noch nicht gebauten Abschnitt 7 — dort gehört an die Einbettungsstelle das JSON-Idiom `<\/script`.
Vermerkt für Abschnitt 7.

## Abschnitte 4 + 5 GEBAUT (24.08.2026 spät, 579/579 grün, PDF-Weg im Browser Ende-zu-Ende verifiziert)

**Abschnitt 4 — Tabellenbaustein (customTable):** neuer Grundtyp mit eigenen Spalten
(Beschriftung + Typ text/Zahl/Betrag, bis 12, Schlüssel eindeutig, erzwingt volle Breite).
Editor: Palette-Vollbreitenknopf, Spalten-Editor in den Eigenschaften, Mini-Tabellen-Vorschau.
Laufzeit-Rendering `cfRenderCustomTable` über eine `renderField`-Umhüllung (`renderField.__cfCustomTable`),
nutzt die generischen `addTableRow/removeTableRow/updateTableCell`. Beiblatt liest Objekt-Zeilen
über `__cfWertText` lesbar. Sanitizer `__cfFeldSaeubern` nimmt `columns`. Export: Tabellen laufen
(mangels struktureller Koordinaten-Zuordnung bewusst) über das Beiblatt — kein Spalten-Anker.

**Abschnitt 5 — PDF-Vordruck + Positionszuordnung (kein pdf.js — Netzsandbox):**
- Server: neue Tabelle `custom_form_templates` (BLOB, `database/index.js` nach intake_files-Index),
  Route `/api/formular-vorlagen/:formId` (GET/GET meta/PUT/DELETE, `form-template-routes.js`),
  eingehängt in `index.js` nach `/api/intake-files`. PUT/DELETE = `requireOfficeProfileEdit`,
  GET = `requireViewDocuments`; 5-MB-Deckel + %PDF-Signaturprüfung; Base64-in-JSON wie intake-files.
  Sicherung: `customFormTemplates` in `portable-data.js` TABLE_REGISTRY, **Variante A**
  (`omitColumns:['data'], metadataOnly:true, restore:false`) — Bytes nur in der SQLite-Vollsicherung,
  Definition wandert portabel über `office_json['custom_forms']`.
- Client (alles im Block `mode-intro-script-v1`, keine neuen Blöcke, Pin 309 gehalten):
  `embeddedPdfBytes` kennt jetzt `customtpl:<formId>` (Sitzungs-Cache → `__cfPdfEmbed` (offline,
  Abschnitt 7) → Server-Fetch). Registrierung (`__eigenformulareRegistrieren` Schritt 2b) hängt bei
  `pdf`+`karte` `OFFICIAL_PDF_TEMPLATES[id]={ready:true,mode:'flat',elementId:'customtpl:id'}` +
  `OFFICIAL_COORDINATE_MAPS[id]=karte` ein (fehlt eines → ready:false / Beiblatt-Dokument);
  Schritt 1 räumt beides + den Byte-Cache beim Löschen ab. Sanitizer `__cfPdfSaeubern`/`__cfKarteSaeubern`
  im `__cfNormalisieren` (nur endliche Positionen zu echten `custom_`-Kennungen, ≤400 Anker,
  Breite/Größe gedeckelt). Karte-Form = OFFICIAL_COORDINATE_MAPS (`text`/`checks`), also läuft der
  Export unverändert über `createOfficialPdf → createCoordinatePdf`.
- Zuordnungseditor als eigenständiges Overlay `window.__cfPdfEditor` (entkoppelt, persistiert über
  `__customFormsMutieren`). Vorschau = **Drahtgitter**: `window.__cfPdfWireframe(bytes)` liest Linien
  (m/l/c/v/y/re/h + q/Q/cm-CTM) UND Textlagen (Textmatrix, Portierung von
  `server/tools/v159-kuratierung/pdf-textlage.js`) direkt aus dem Inhaltsstrom via
  `PDFLib.decodePDFRawStream` (das Browser-Bundle exportiert es — geprüft, 311 Exports). Subset-Font-
  Text ohne lesbare Glyphen wird als graue Leiste gezeichnet. Canvas ZIEL-Breite 640; Klick →
  PDF-Punkt (y gespiegelt). Text-Anker (rot) bzw. je Auswahl ein Kreuz (grün); Reiter je Seite.
  Einstieg: Knopf „Vordruck & Positionen" je eigenem Formular in der Verwaltungsliste.
- Tests: `html-formulareditor.test.cjs` jetzt 27 (Server-Route-Rechte/%PDF/5MB/Mount/Tabelle/
  Backup-Registry; Karte-Sanitizer; Register-ready/-cleanup; customtpl-Zweig; Editor-Verdrahtung).
- Verifiziert: (a) echter Parser-Round-Trip in Node mit dem Browser-Bundle — Linie/Rechteck/Textlage
  koordinatengenau; (b) Server frisch gebootet auf eigenem Port → Route 401 (nicht 404), Tabelle
  angelegt; (c) Browser-Sichtprobe (eigenständige Harness, kein Login nötig): Overlay rendert den
  Wireframe, Feldwahl + Text-/Kreuz-Anker setzen Marker, Speichern liefert eine gültige Karte mit
  echten PDF-Punkten. **Achtung:** die laufenden Nutzer-Server (8935/8940) sind vor diesen Server-
  Änderungen gestartet → für den Live-Upload muss der Server einmal neu gestartet werden.

**Noch offen aus dem Plan:** Abschnitt 6 (Verwaltung — Kopieren läuft, Rest kosmetisch),
Abschnitt 7 (Außendienst/Lokal-Einbettung: `custom_`-Ausschluss in `dokumenteLesen` aufheben,
`__cfPdfEmbed` + `custom_forms` in die cloneNode-Nutzlast, JSON-Idiom `<\/script`).

## Abschnitte 6 + 7 GEBAUT (24.08.2026 nachts, 589/589 grün, 2× adversarial reviewed)

**Abschnitt 6 — Kopieren mitgelieferter Formulare inkl. statischer PDF-Zuordnung:**
`kopieren(id)` führt jetzt eine alt→neu-Feld-ID-Map (`remap`), erhält den Tabellenbaustein
(customTable+columns statt Degradierung zu textarea) und überträgt die Koordinatenkarte des
Originals: `OFFICIAL_COORDINATE_MAPS[id]` (bzw. `karte` eines Eigenformulars) wird per Remap auf die
Kopie umgeschrieben (`stamm.*`-Schlüssel bleiben unverändert, `tables` fallen weg), und
`form.pdf={fileName,seiten,quelleElementId}` verweist auf die Original-Bytes — KEINE Byte-Kopie.
Neue Bausteine: `__cfPdfSaeubern` hält `quelleElementId` (`/^([a-z0-9_]+|customtpl:custom_[a-z0-9_]+)$/`);
`__cfKarteSchluesselOk` lässt `custom_*` UND `stamm.*` zu; `__cfPositionSaeubern` erhält jetzt auch
prefix/charStep/lineHeight/clear (treue Amtsvordruck-Kopien; prefix mit leichter `<>`-Säuberung statt
`__cfText`, damit bedeutungstragende Leerzeichen bleiben); Registrierung 2b nutzt
`elementId=(form.pdf.quelleElementId)||('customtpl:'+id)`. GEHT für flat-Koordinaten-Vordrucke
(kg1/kgan/kg11e + Justiz-Karten); acroform-Formulare bleiben Druck/Briefkopf. Kopie einer Kopie
FLACHT AB (kopieren trägt `eigen.pdf.quelleElementId` = Wurzel weiter), zeigt also immer auf den
echten Byte-Eigentümer/statische tpl_-Vorlage — verifiziert.

**Abschnitt 7 — Einbettung in Lokal-/Außendienstdatei:**
Riegel in `dokumenteLesen` (91109) entfernt → Eigenformulare sind mitnehmbar. Generator
`__adErzeugen` bettet nach der Vorlagen-Nachladeschleife ein: (a) Definition der GEWÄHLTEN
Eigenformulare als **dynamisch** erzeugten `#embeddedCustomForms`-Knoten (createElement, hinter
`#embeddedFieldData` per insertBefore → landet VOR dem Parse-Zeit-Leser bei Z.117605; NICHT im
Quelltext → Blockzahl bleibt 309), JSON mit `</`→`<\/`-Entschärfung; (b) die benötigten PDF-Bytes
als `cfpdf:<id>`-pdf-base64-Blöcke. `embeddedPdfBytes` liest offline `getElementById('cfpdf:'+formId)`.
Statische `customtpl:`-IDs sind aus der Amtsvorlagen-Maschinerie (mitVorlagenIds/pruefeInhalt)
ausgeklammert (`istStatisch`); kopierte tpl_-Vordrucke reisen über den bestehenden
data-server-template-Weg. Der Parse-Zeit-Leser registriert synchron VOR dem async Loader-Filter
(aussendienst-2b-v1, REPORTS.splice auf kopf.dokumente) — Reihenfolge belegt.

**Adversariale Review (2 Runden, 5 Lenses + Gegenprüfung) fand 5 echte Bugs, alle behoben:**
- **A (hoch):** cfpdf-Knoten wurde `.type` VOR `.id` erzeugt → Serialisierung type-first → die
  id-first-Regex in `pruefeInhalt` matchte NIE → jede Datei mit eigenem Vordruck fälschlich
  abgewiesen. Fix: `.id` vor `.type` (id-first wie tpl-Blöcke) + Regex reihenfolgetolerant
  (type-frei). Im echten Browser verifiziert: `<script id="cfpdf:.." type="..">`, beide Regex matchen.
- **B (hoch):** Kopie eines Eigen-Uploads (`quelleElementId=customtpl:custom_A`) — wurde nur die
  Kopie gewählt, fehlten A's Bytes offline. Fix: Byte-Quellen AUFLÖSEN (`cfByteIds`: eigener Upload→
  f.id, customtpl:custom_X→X, tpl_ übersprungen), auch wenn die Quelle selbst nicht gewählt ist.
- **C (mittel):** pauschales `catch(_e){}` schluckte unerwartete Fehler → stille unvollständige
  Datei; `arrayBuffer()` nicht im Abbruchpfad. Fix: `catch(cfFehler)` bricht sauber ab (Alert+return),
  arrayBuffer in try, `pruefeInhalt` prüft `defErwartet` (Definition vorhanden+nicht leer).
- **D (niedrig):** `hiddenBuiltins` gegen die Auswahl gefiltert (`cfAlleErlaubt`) — ein gewähltes
  Builtin wird nie ausgeblendet.
- **E (niedrig):** `__stammwertV262` mit `Object.prototype.hasOwnProperty.call` — `stamm.constructor`
  u.ä. liefern keine geerbte Funktion mehr als Feldwert.
- **Nachgezogen (mittel):** fail-closed — fehlt ein gewähltes Eigenformular im Stand (Def-Fetch
  scheitert / in anderem Fenster gelöscht), bricht der Generator ab statt still forms:[] einzubetten.
- **Bekannt/konsistent (niedrig, KEIN Regress):** die Abbruchpfade räumen den work-toast nicht auf —
  identisch zu ALLEN bestehenden Abbruchpfaden der Funktion; bewusst nicht divergiert.

Tests: `html-formulareditor.test.cjs` jetzt ~40 (Abschnitt-6/7-Verdrahtung, Sanitizer, Registrierung,
Fail-closed, Selbstprüfung), `html-field-service-document-selection.test.cjs` unverändert grün.
Damit sind ALLE 7 Bauabschnitte des Plans umgesetzt.
