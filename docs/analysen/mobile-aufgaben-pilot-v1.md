# Aufgaben als mobiles Pilotmodul

Fortschreibung: Auch der Aufgaben-Pilot verwendet inzwischen den [gemeinsamen Navigationsstandard mit dynamischem Ein-/Ausblenden](mobile-navigation-standard-v1.md).

Umgesetzt am 07.09.2026 auf dem mobilen Fundament und dem Release v0.7.7 (`9b28c434343743b116da66f37cb88d0b7cbc2019`). Die Änderungen liegen lokal auf `codex/mobile-foundation-chats`. Sie sind nicht veröffentlicht.

Die echte Aufgabenoberfläche verwendet jetzt die gemeinsamen mobilen Kopfzeilen, Listen-, Detail- und Formularansichten, Filterblätter und festen Aktionsleisten. Gestaltung und Aufteilung folgen dem freigegebenen Aufgaben-Mockup: dunkle Kopfzeile, flache Listenzeilen, Statusauswahl, Filterchips, große Eingaben und ein Plusknopf. Chats mit Mitarbeiterchat-Badge bleibt in der unteren Navigation erreichbar. Die mobile Aktivierung und die ursprüngliche Desktopansicht bleiben erhalten.

Wie bestätigt werden Fall- und Listenzuordnungen verwendet. Es wurde kein neues Feld für Mitarbeiterzuständigkeit eingeführt.

## Funktionsumfang

| Bereich | Umsetzung und erhaltene Funktionen |
| --- | --- |
| Liste | Offen, Erledigt und Alle mit Zählern; Aufgaben und vorhandene verknüpfte Wiedervorlagen; Fall, Listenfarbe, Notizvorschau, Fälligkeit, Priorität und Serienkennzeichnung |
| Suche | Titel, Notiz, Fall und Listenbezeichnung; direktes Zurücksetzen |
| Filter | Alle Termine, überfällig, heute, diese Woche, ohne Termin; Hoch/Normal/Niedrig; Fall anhand seiner ID; Aufgabenliste; Aufgaben/Wiedervorlagen; kombinierbar mit Vorschau der Trefferzahl |
| Sortierung | Fälligkeit, Priorität, Titel und bestehende manuelle Reihenfolge; mobil mit Auf-/Ab-Schaltflächen bedienbar |
| Listen | Ein-/Ausblenden einzelner Listen, Alle/Keine, lokale und externe Listen, Wiedervorlagen, Standard- und Listenfarben mit Zurücksetzen; bestehende persönliche Einstellungen werden weiterverwendet |
| Details | Vollständiger Titel und Notiz, Fall, Beginn, Fälligkeit, Priorität, Liste, Wiederholung, vorhandene Quellverknüpfung, Anlagen-Downloads, Blättern innerhalb der Ergebnisliste |
| Status | Erledigen und wieder öffnen; Serienaufgaben rücken über die bestehende Logik auf die nächste Fälligkeit vor; automatische Falldokumentation bleibt angeschlossen |
| Formular | Originalfelder für Titel, Fall, Beginn, Fälligkeit, Priorität, Speicherort und Liste, Notiz, Wiederholung, Intervall und Enddatum; feste Speichern-/Abbrechen-Aktionen |
| Anlagen | Auswahl über den bestehenden Datei-/Kamera-Zugang, Übernahme aus dem Datei-Explorer, ausstehende Dateien entfernen, vorhandene Anlagen herunterladen/hinzufügen/entfernen; ausdrückliche Übertragung an verknüpfte Vikunja-/OpenProject-Aufgaben |
| Werkzeuge | ICS-Import, Einzel- und Gesamtexport, Online-Synchronisierung und Löschen mit Bestätigung |
| Verknüpfungen | Bestehende Fall-IDs, Eintragsarten und Metadaten verknüpfter Planungsaufgaben bleiben im originalen Speicherweg erhalten |

Der ICS-Gesamtexport enthält weiterhin sämtliche Aufgaben des Fallfilters einschließlich erledigter und ausgeblendeter Aufgaben. Das Auswahlblatt benennt diesen Umfang ausdrücklich.

Die vorhandene Server-API erlaubt beim Bearbeiten keinen Wechsel der externen Verbindung oder Aufgabenliste. Das Formular kennzeichnet diese Felder deshalb als bestehenden Speicherort. Bei neuen Aufgaben stehen die bisherigen Verbindungen und Listen zur Auswahl.

## Entwürfe und Fehlerfälle

- Echtzeitaktualisierungen und Chat-Ausflüge bewahren den tatsächlichen Formular-DOM und seine Eingaben.
- Anlagenänderungen aktualisieren ausschließlich den Anlagenbereich; ungespeicherte Formularfelder bleiben erhalten.
- Abbrechen, Escape, Schließen und Wechsel über die mobile Navigation fragen bei geänderten Entwürfen nach. Ein laufender Speichervorgang wird geschützt.
- Ein fehlgeschlagenes Speichern hält das Formular offen und zeigt den Fehler dort an.
- Schlägt nach dem Anlegen ein Anlagen-Upload fehl, bleiben die betroffenen Dateien zur Wiederholung erhalten. Erneutes Speichern aktualisiert dieselbe Aufgabe und erzeugt keine zweite Aufgabe.
- Fälligkeit vor Bearbeitungsstart wird im Formular abgefangen. „Überfällig“ bezieht sich auf den lokalen Kalendertag; eine heute fällige Aufgabe ist nicht schon am Nachmittag überfällig.
- Ladefehler zeigen einen Wiederholungszugang. Abgelehnte Löschvorgänge werden nicht als erfolgreich behandelt.

## Prüfung

- **42 Browserprüfungen** der echten ausgelieferten HTML-App mit simulierten Aufgaben und vollständig abgefangenen Serverzugriffen: vollständiger Arbeitsablauf, Fehler, Anlagen, Status, Serien, Suche, Filter, Listen, Farben, Sortierung, ICS, Synchronisierung, Entwürfe und Chat-Rückweg.
- **72 gezielte Tests** erfolgreich, einschließlich aller vorhandenen Mobiltests, Dokumentation, Fallkontext und zusätzlicher Aufgabenfilter-Prüfungen. Alle 229 JavaScript-Blöcke der HTML-App sind syntaktisch gültig.
- Die bestehende Browserprüfung für Dokumentation und Chats ist zusätzlich erfolgreich durchgelaufen.
- Geprüfte Breiten: 320, 360, 390 und 430 px in Hell/Dunkel; zusätzliche schmale Formularprüfungen, 390 × 480 px und Desktop mit 1366 px.
- Vollständige Suite: **1.221 Tests, 1.217 erfolgreich, drei fehlgeschlagen, einer übersprungen**. Die drei Fehler entsprechen den bereits am unveränderten Release nachgewiesenen Fehlern: Backup-Tabellenregistrierung, Recovery-Bootstrap (`office_ai_config.allowed_models`) und V230-PDF-Golden-Rendering. [Vorheriger Gegenbeweis](mobile-fundament-v1/baseline-fehler.txt).

Die Browserprüfungen verwenden Testdaten. Eine Abnahme auf physischen Smartphones und mit echten Mehrbenutzerkonten steht vor Veröffentlichung noch aus.

## Ansichten und Reproduktion

- [Aufgabenliste](mobile-aufgaben-pilot-v1/aufgaben-liste.png)
- [Details](mobile-aufgaben-pilot-v1/aufgabe-details.png)
- [Formular](mobile-aufgaben-pilot-v1/aufgabe-formular.png)
- [Aufgabenfilter](mobile-aufgaben-pilot-v1/aufgaben-filter.png)
- [Dunkle Darstellung](mobile-aufgaben-pilot-v1/aufgaben-dunkel-360.png)
- [42 Browserprüfungen](mobile-aufgaben-pilot-v1/browser-pruefung.txt), [gezielte Tests](mobile-aufgaben-pilot-v1/gezielte-tests.txt), [Fundament-Regression](mobile-aufgaben-pilot-v1/fundament-regression.txt), [vollständige Suite](mobile-aufgaben-pilot-v1/vollstaendige-testsuite.txt)

Browserprüfung: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright node server/scripts/qa-mobile-tasks.cjs`. Die zusätzlichen Verhaltenstests liegen in `server/tests/html-mobile-tasks.test.cjs`. Die produktive Umsetzung befindet sich im bestehenden Kalender-/Aufgaben-Skript und den mobilen Styles der ausgelieferten HTML-Datei; das ursprüngliche Formular, die Speicherfunktionen und Server-Endpunkte werden weiterverwendet.
