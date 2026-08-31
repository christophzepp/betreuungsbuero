# Befund: Speicherort für nutzereigene Formulardefinitionen

## 1. Funktionsweise der `/api/office-json/:key`-Endpunkte

**Mount und Auth-Kette** (server/index.js): Der Router hängt unter `/api/office-json` (index.js:211) hinter der Session-Middleware (index.js:165), dem Recovery-Gate (index.js:167, Schreibsperre während geschützter Wiederherstellung) und `requireOnlineMode` (index.js:173, Local-Mode-Sessions kommen nicht durch).

**Router** (server/src/modules/office/json-routes.js):
- **Nur GET und PUT**, kein POST/DELETE: `GET /:key` mit `requireViewCases` (Zeile 199), `PUT /:key` mit `requireEditCases` (Zeile 212). Zusätzlich `requireAuth` für alles (Zeile 14). Die Rechte-Flags sind `can_view_cases`/`can_edit_cases` je Nutzer, Admin ist immer ausgenommen (src/middleware/authentication.js:142–143).
- **Schlüssel-Whitelist statt freiem KV** (Zeile 28): `ai_chats`, `case_intakes`, `case_outtakes`, `ui_prefs`, `suggestion_registry`, `mailx_case_links`, `mailx-labels`, `kontaktmonitor`, `qualifikationen`, `aussendienst_ledger`. Unbekannter Schlüssel → 404. Der Kopfkommentar (Zeilen 1–6) erklärt das ausdrücklich als Registrierungspunkt: „jeder neue Verbraucher wird hier eingetragen".
- **Per-Schlüssel-Sonderrechte** sind vorgesehen und vorgeführt: `aussendienst_ledger` verlangt `canUseFieldService` (Zeilen 155–160), das Schreiben von `ui_prefs`/`suggestion_registry` verlangt `isAdmin || canManageOfficeProfile` (Zeile 218).
- **Ablageort**: KEINE Dateien auf der Platte, sondern die SQLite-Tabelle `office_json` (`key` PRIMARY KEY, `data_json`, `updated_at`, `updated_by`) — src/database/index.js:96–101. Die Datenbank liegt unter `RUNTIME_ROOT/database/betreuungsbuero.sqlite3` (src/config/paths.js:26–29; `RUNTIME_ROOT` = `<projekt>/runtime`, per Env übersteuerbar, paths.js:16–19). Ein Schlüssel = EIN JSON-Blob.
- **Format/Grenzen**: Body ist `{data: <beliebiges JSON>}`; gespeichert wird `JSON.stringify(data)`. Deckel **15 MB je Schlüssel** (json-routes.js:232, „für Zustände, nicht für Dateien"); global gilt der express.json-Deckel von 350 MB (index.js, `JSON_DECKEL`).
- **Echtzeit**: jede erfolgreiche Nicht-GET-Antwort wird als Ereignisbereich `officeJson` an alle verbundenen Fenster gemeldet (json-routes.js:16 + src/modules/office/events.js:16–24) — offene Ansichten zeichnen sofort neu.
- **Materialisierung**: jeder Schreiber ruft `markOfficeMaterialization()` (json-routes.js:92–98), damit das lesbare Büroabbild aktualisiert wird.
- **Sonderfälle**: `kontaktmonitor` und `case_intakes` werden beim Ausliefern fallbezogen gefiltert (`FALLBEZOGENE_SCHLUESSEL`, Zeile 36; Filter Zeilen 76–89); `case_intakes` hat zusätzlich serverseitiges Merge gegen Verlust fremder Einträge (Zeilen 112–153) und ausgelagerte OCR-Volltexte mit eigenen Unterrouten `GET/PUT /case_intakes/ocr/:draftId` (Zeilen 166, 181).

**Heutige Nutzer im Client** (Beispiele aus der App-Datei): `ai_chats` (outputs/…v0_7.html:10351/10362), `ui_prefs` (36922, 57870), `case_intakes` (67872/67877), `case_outtakes` (70431), Muster stets `fetch('/api/office-json/<key>')` bzw. `PUT {data:…}`.

**Direkte Tabellen-Nutzer AN der Route vorbei** (kein Whitelist-Eintrag nötig): `documents_config` über `/api/documents/config` (src/modules/documents/routes.js:243–246, GET 1415 `requireViewDocuments`, PUT 1436 `requireEditDocuments`); `user_theme_preferences` über `/api/user-prefs/theme` (src/modules/settings/theme-preferences.js:3–18); MCP-Werkzeuge lesen/schreiben generisch per `officeJsonMerge` (src/integrations/mcp/tools.js:226–233) sowie `kontaktmonitor`/`qualifikationen`/`ai_chats`/`ui_prefs` (tools.js:1077, 1120, 1125, 1204); das Postfach liest `mailx_case_links` (src/modules/mail/mailbox-routes.js:293).

## 2. Weitere generische Speicher

| Speicher | Route | Zweck / Eigenschaften |
|---|---|---|
| `office_json` | `/api/office-json/:key` | büroweit geteilt, 1 Blob/Schlüssel, 15 MB, Whitelist (s. o.) |
| `user_ui_prefs` (Tabelle) | `/api/user-prefs/:key` | **je Nutzer** kleine Oberflächenzustände; Schlüssel `case-overview`, `mobile-navigation`, `dashboard`, `mode-intro`; Deckel 32 KB, teils strenge Schema-Validierung (src/modules/settings/user-preference-routes.js:7–8, 118–124) |
| `documents_config` (in `office_json`) | `/api/documents/config` | büroweite Konfiguration des Dokumentenmoduls (Speicherwurzel, Tags, Papierkorb-Tage …), Dokumente-Rechte statt Fall-Rechte |
| `office_contacts` (Tabelle) | `/api/office-contacts` | büroweites Adressbuch, EIN Blob je Kontakt als eigene Zeile (src/database/index.js:83–89) — das Muster „eigene Tabelle", wenn Einzel-Einträge eigene Zeilen brauchen |
| `user_settings_overrides` | `/api/my-settings` | nutzerbezogene Zugangs-Overrides (KI/Versand/Mail/Karten), Gruppe „credentials" |
| `intake_files` (Tabelle) | `/api/intake-files` | Datei-Bytes ausdrücklich NICHT in office_json (Kommentar src/database/index.js:103–106) |

## 3. Sicherungswege — eine neue office-json-Sammlung wandert automatisch mit

Die einzige Quelle der Sicherungs-Klassifizierung ist die `TABLE_REGISTRY` (src/modules/backup/portable-data.js:23); `office_json` ist dort **als ganze Tabelle** registriert mit Gruppen `['office','module']` (portable-data.js:98). Daraus folgt:

1. **Vollsicherung „gesamt"** (Plan D8, `doc_backup_jobs`): konsistente SQLite-`.backup`-Kopie der GESAMTEN Datenbank plus runtime/data-Baum (src/modules/backup/document-backup.js:1–8). Jeder office_json-Schlüssel ist automatisch drin.
2. **Admin-Moduldaten-Export** `GET /api/admin/backup-module-data` (src/modules/admin/routes.js:1855) über `moduleData()` (portable-data.js:874–903): office_json wird **generisch gedumpt (SELECT \*)**, ausdrücklich NICHT über eine Schlüsselliste — der Kommentar admin/routes.js:1850–1852 nennt genau das als Lehre aus einem Altfehler („Neue Schluessel sind damit automatisch dabei").
3. **Restore** `POST /api/admin/restore-module-data` (admin/routes.js:1865) mit `restoreDefinitions('module')` (portable-data.js:914–976): office_json bekommt Modus `replace` — neue Schlüssel werden ohne Zutun wiederhergestellt.
4. **Lesbares Büroabbild** (Materialisierung): `officeData()` dumpt office_json ebenfalls generisch (portable-data.js:727–772), genutzt in src/modules/documents/materializations.js:266; das Abbild wird nach jedem office-json-Schreiber per `markOfficeDirty` aufgefrischt.

Einzige Sonderbehandlung existiert für `case_intakes` (OCR-Hydration beim Export, portable-data.js:757–769 und 889–901) — für einen neuen Schlüssel ist nichts dergleichen nötig.

## 4. Empfehlung: bestehenden office-json-Speicher mit neuem Schlüssel `custom_forms` nutzen

**Empfehlung: JA, `custom_forms` als neuen Whitelist-Schlüssel in `KEYS` (json-routes.js:28) eintragen — keine eigene Route bauen.**

Begründung:
- **Fachlich passgenau**: Formulardefinitionen (Abschnitte + Felder) sind geteilte, büroweite, kleine JSON-Strukturen — exakt der deklarierte Zweck des Speichers. Selbst hunderte Baukasten-Formulare bleiben weit unter dem 15-MB-Deckel, solange keine Datei-/PDF-Bytes eingebettet werden (die gehören in den Dokumentenspeicher, siehe intake_files-Präzedenz src/database/index.js:103–106).
- **Sicherung, Restore und Büroabbild gratis und belastbar**: durch die generischen Dumps (Punkt 3) ist die Sammlung ab dem ersten Schreiben in Vollsicherung, Moduldaten-Export/-Restore und lesbarem Büroabbild enthalten — genau die Fehlerklasse „neuer Speicher fehlt in der Sicherung" ist hier konstruktiv ausgeschlossen. Eine eigene Tabelle müsste dagegen in `TABLE_REGISTRY` UND ggf. `restoreDefinitions`-Prioritäten nachgezogen werden.
- **Echtzeit gratis**: der `officeJson`-Ereigniskanal (json-routes.js:16) benachrichtigt alle offenen Fenster — der Formulareditor mehrerer Nutzer bleibt ohne Zusatzcode synchron sichtbar.
- **Rechte-Feintuning ist vorgesehen**: Da Formulardefinitionen eher büroweite Vorgaben als Falldaten sind, sollte das Schreiben wie bei `ui_prefs` auf `isAdmin || canManageOfficeProfile` verschärft werden — eine Zeile in der bestehenden PUT-Prüfung (json-routes.js:218) bzw. in `checkKeyPermission` (json-routes.js:155).
- **Client-Muster existiert**: GET/PUT mit `{data:…}` ist in der App x-fach vorgeführt (z. B. outputs/…v0_7.html:67872/67877).

**Bewusst in Kauf genommene Schwäche + Gegenmittel**: PUT ersetzt den GANZEN Blob (last-write-wins). Bearbeiten zwei Nutzer gleichzeitig verschiedene Formulare, kann ein Stand verloren gehen — dasselbe Risiko trägt heute schon `kontaktmonitor`/`qualifikationen`. Empfohlene Struktur daher `{entries:[{id, title, sections:[…], updatedAt, updatedBy}, …]}`; wird Gleichzeitigkeit real ein Problem, existiert mit `mergeCaseIntakes` (json-routes.js:112–153) ein kopierbares Vorbild für serverseitiges Per-Eintrag-Merge im selben Router — der Aufrüstpfad bleibt also offen, ohne die Route zu wechseln.

**Eigene Route/Tabelle** lohnte erst, wenn je Formular eigene Zeilen mit eigener Sichtbarkeit (wie `office_contacts`) oder Versionierung/Konfliktbehandlung je Formular gebraucht würden. Für den geplanten Baukasten-Editor (anlegen/bearbeiten/löschen weniger Bürovorlagen; Löschen = Blob ohne den Eintrag zurückschreiben) ist das Überbau.

## Codestellen
- server/index.js:211: Mount des Routers: app.use('/api/office-json', require('./src/modules/office/json-routes'))
- server/index.js:165-173: Auth-Kette davor: Session-Middleware, recoveryMode.apiGate (167), requireOnlineMode (173)
- server/src/modules/office/json-routes.js:28: Schlüssel-Whitelist KEYS (ai_chats, case_intakes, case_outtakes, ui_prefs, suggestion_registry, mailx_case_links, mailx-labels, kontaktmonitor, qualifikationen, aussendienst_ledger) — hier müsste 'custom_forms' eingetragen werden
- server/src/modules/office/json-routes.js:199: GET /:key mit requireViewCases
- server/src/modules/office/json-routes.js:212: PUT /:key mit requireEditCases; einzige HTTP-Methoden sind GET und PUT
- server/src/modules/office/json-routes.js:232: Größendeckel: 15 MB je Schlüssel (413 bei Überschreitung)
- server/src/modules/office/json-routes.js:218: Per-Schlüssel-Rechteverschärfung: ui_prefs/suggestion_registry schreiben nur mit isAdmin||canManageOfficeProfile — Vorbild für custom_forms
- server/src/modules/office/json-routes.js:155-160: checkKeyPermission: aussendienst_ledger verlangt canUseFieldService — zweites Muster für Sonderrechte je Schlüssel
- server/src/modules/office/json-routes.js:16: Echtzeit-Middleware: erfolgreiche Schreiboperationen werden als Bereich 'officeJson' an alle Fenster gemeldet (events.js:16-24)
- server/src/modules/office/json-routes.js:112-153: mergeCaseIntakes: serverseitiges Per-Eintrag-Merge gegen Lost-Updates — kopierbares Vorbild, falls custom_forms Gleichzeitigkeitsschutz braucht
- server/src/database/index.js:96-101: Tabelle office_json (key PRIMARY KEY, data_json, updated_at, updated_by) — Ablage in SQLite, nicht als Dateien
- server/src/config/paths.js:16-29: RUNTIME_ROOT = <projekt>/runtime (Env-übersteuerbar); DATABASE_PATH = runtime/database/betreuungsbuero.sqlite3
- server/src/modules/backup/portable-data.js:98: office_json in TABLE_REGISTRY mit Gruppen ['office','module'] — generischer Dump, neue Schlüssel automatisch in Sicherung und Büroabbild
- server/src/modules/admin/routes.js:1850-1855: Kommentar + Route backup-module-data: office_json wird GENERISCH gedumpt (SELECT *), nicht über Schlüssellisten — neue Schlüssel automatisch dabei
- server/src/modules/admin/routes.js:1865-1870: restore-module-data: restoreDefinitions('module') stellt office_json im Modus 'replace' wieder her
- server/src/modules/backup/portable-data.js:727-772: officeData(): lesbares Büroabbild, office_json generisch enthalten (Sonderfall nur case_intakes-OCR-Hydration 757-769)
- server/src/modules/backup/document-backup.js:1-8: Vollsicherung 'gesamt': konsistente SQLite-.backup-Kopie der ganzen DB — office_json immer enthalten
- server/src/modules/documents/materializations.js:266: Büroabbild-Generator nutzt backupData.officeData(db, …); Auffrischung nach jedem office-json-Schreiber via markOfficeDirty
- server/src/modules/documents/routes.js:243-246: documents_config: direkter Tabellenzugriff auf office_json AN der generischen Route vorbei (GET /api/documents/config Z.1415, PUT Z.1436)
- server/src/modules/settings/user-preference-routes.js:7-8: Zweiter generischer Speicher: user_ui_prefs je Nutzer (/api/user-prefs/:key, 32-KB-Deckel, eigene Schlüssel-Whitelist)
- server/src/modules/settings/theme-preferences.js:3-18: Theme-Einstellungen aller Nutzer als office_json-Schlüssel 'user_theme_preferences' (direkter Tabellenzugriff)
- server/src/integrations/mcp/tools.js:226-233: MCP-Werkzeuge schreiben office_json direkt per officeJsonMerge (ohne updated_by) — bei neuem Schlüssel prüfen, ob MCP-Zugriff gewünscht ist
- outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:67872-67877: Client-Muster: fetch GET /api/office-json/case_intakes bzw. PUT mit {data:{entries:[...]}}
- server/src/middleware/authentication.js:142-143: requireViewCases/requireEditCases = Flags can_view_cases/can_edit_cases, Admin immer ausgenommen
- server/src/database/index.js:103-106: Grundsatz: Datei-Bytes gehören NICHT in office_json (15-MB-Deckel ist für Zustände) — intake_files als Präzedenz