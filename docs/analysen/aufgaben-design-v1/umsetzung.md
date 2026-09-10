# Aufgabenmenü: Umsetzung und Prüfung

Stand: 10.09.2026. Grundlage ist der korrigierte Aufgabenentwurf (`mockup.html`). Die echte Oberfläche steckt im bestehenden `calendar-todo-script-v1` und im neuen, ausschließlich auf `#todoWorkspace` begrenzten Stilblock der Auslieferungsdatei. Es gibt keine zusätzliche Aufgaben-Datenbank und keine Migration.

## Vergleich mit dem Mockup

Übernommen sind Suche oberhalb des Arbeitsbereichs, Fall- und Fälligkeitsfilter links, die Statusauswahl Offen/Erledigt/Alle mit berechneten Anzahlen, Fälligkeitsgruppen, unterschiedliche Icons für Aufgabe und Wiedervorlage, Listenfarben, Notizvorschau, Priorität, Serien- und Anlagenkennzeichnung sowie Details mit vollständigen Angaben.

Die Detailspalte erscheint auf großen Bildschirmen rechts. Bis 880 Pixel Breite ersetzen Details, Formular, Filter und Listenfarben die Übersicht. Die Formulare verwenden die Abschnitte Aufgabe, Termin & Wiederholung, Zuordnung, Notiz und Anlagen. Die Auswahlfelder haben auch in Safari einheitliche Höhen und Pfeile.

Für die Einbettung in das echte Programm wurden die wichtigsten Formular- und Detailaktionen am unteren Fensterrand befestigt; der Inhalt darüber scrollt. Die zusätzliche simulierte Programmleiste und der Beispieldatenhinweis des Mockups entfallen. Das Fenster besitzt einen eigenen Schließen-Knopf. Das Datum kommt aus der laufenden Anwendung.

Visuell kontrolliert: Desktopliste, Desktopdetails, Desktopformular, mobile Liste, mobile Filter, mobiles Formular, Hell- und Dunkelmodus. Die Prüfung der Ansichten umfasst 1440, 1024, 880, 768, 390 und 320 Pixel. Dunkle Überschriften und Auswahlfelder wurden nach dem Sichtabgleich korrigiert. Lange Texte und kleine Bildschirmhöhen wurden mitgeprüft.

Vergleichsbilder der endgültigen Fassung liegen in `chromium/` und `webkit/`.

## Funktionsabgleich

| Funktion | Reale Umsetzung und Prüfung |
| --- | --- |
| Aufgaben und Wiedervorlagen | Vorhandene Typenerkennung bleibt maßgeblich; eigene Icons und Typfilter, Quellbezug bleibt gespeichert. |
| Fallzuordnung und Fallfilter | Vorhandene Fall-IDs und Altbestandszuordnung; Auswahl auch im mobilen Filter. |
| Suche und Status | Titel, Notiz, Fall und Listenname; Offen, Erledigt und Alle einschließlich passender Anzahlen. |
| Fälligkeit, Priorität, Typ und Liste | Kombinierbare Filter, Trefferzahl vor Übernahme, einzelne Filter zurücksetzen. |
| Sortierung | Fälligkeit, Priorität, Titel und manuell; bestehende Reihenfolge wird gespeichert, unsichtbare Positionen bleiben erhalten. |
| Verschieben | Pfeile und Drag-and-drop mit passender Einfügemarkierung; beide Browserengines geprüft. |
| Vollständige Details | Fall, Beginn, Fälligkeit, Priorität, Liste, Wiederholung, Notiz, Quelle, Anlagen sowie vorheriger/nächster Eintrag. |
| Neue Aufgabe / Bearbeiten | Originalfelder und vorhandene Speicherwege; lokale und Online-Speicherung geprüft. |
| Wiederholung | Frequenz, Intervall, optionales Enddatum und vorhandene Serienparameter; Erledigen schreibt die Fälligkeit fort. |
| Erledigen / Wiederöffnen | Direkt in der Liste und in den Details; Fehler stellen den vorherigen Status wieder her. |
| Externe Zuordnung | Vorhandene Verbindung und Liste bleiben erhalten. Die Serverbeschränkung beim Bearbeiten wird weiterhin berücksichtigt. |
| Verknüpfte Quellen | Bestehende Metadaten und Speicher-Rückmeldungen bleiben im Originalspeicherweg erhalten. Eine bearbeitete Wiedervorlage behält Ursprung und Typ. |
| Anlagen | Originale Download-, Hinzufügen-, Entfernen- und Übertragen-Funktionen; Anlagenzahl zusätzlich in der Liste. |
| Datei-Explorer | Dateiübernahme funktioniert über den vorhandenen Datei-Dialog und Uploadweg. Der Dialog erhält den Fall der bearbeiteten Aufgabe. |
| Fehler bei Anlagen | Formulareingaben bleiben erhalten. Fehlgeschlagene Dateien können erneut hochgeladen werden; eine bereits angelegte Aufgabe wird dabei nicht dupliziert. |
| Listen und Farben | Anzeigen/Ausblenden, Alle/Keine, Standardfarbe, einzelne Farben und Zurücksetzen verwenden die bestehenden Kalenderpräferenzen. |
| ICS | Import, Einzel-Export und Gesamtexport des Fallfilters. Gesamtexport umfasst weiterhin erledigte und ausgeblendete Aufgaben; Wiedervorlagen sind einzeln exportierbar. |
| Synchronisierung | Vorhandener Synchronisierungsendpunkt; Rückmeldung am Arbeitsbereich, offene Formulare bleiben erhalten. |
| Löschen | Bestehender Löschweg mit Bestätigung; andere Einträge bleiben erhalten. |
| Entwurfsschutz | Abbrechen, Zurück, Schließen, Escape und mobiler Bereichswechsel schützen ungespeicherte Eingaben. |
| Kalender und Chats | Mobile Kalenderaufgabe öffnet die neue Detailansicht und kehrt zum Kalender zurück. Chat-Rückkehr erhält den Formular-DOM. Desktopaufgaben im Kalender behalten dessen bestehenden Detail-/Speicherweg. |
| Fehler beim Laden | Bereits geladene Aufgaben bleiben sichtbar, erneutes Laden ist erreichbar. |

## Behobene Fehler

- Neue Aufgabe aus einer geöffneten Detailansicht verwendet ein leeres Formular.
- Abgebrochene Statuswechsel hinterlassen kein falsches Häkchen.
- Filterentwürfe bleiben beim Zwischenwechsel zu Listenfarben erhalten.
- Fehlgeschlagene Uploads behalten Datei und ungespeicherte Eingaben.
- Ein Teilerfolg beim Anlegen erzeugt bei Wiederholung keine zweite Aufgabe.
- Fälligkeit vor Bearbeitungsstart und Serienende vor erster Fälligkeit werden zurückgewiesen.
- Ausgeschaltete Wiederholung blockiert nicht durch unsichtbare Pflicht-/Intervallfelder.
- Eine verspätete Bearbeitungsantwort öffnet ein bereits geschlossenes Fenster nicht erneut.
- Verspätete Synchronisierung ersetzt kein inzwischen geöffnetes Formular.
- Schließen und erneutes Öffnen der Aufgabenverwaltung funktionieren auch bei wiederverwendetem Dialog.
- Dateiübernahme aus dem Explorer verwendet den Aufgabenfall statt eines möglicherweise anderen, im Hintergrund geöffneten Falls.
- Ein inzwischen gelöschter lokaler Eintrag wird beim Speichern als Fehler gemeldet.

## Prüfergebnis

- 110 Browserprüfungen in Chromium bestanden.
- 110 Browserprüfungen in WebKit, der Safari-Browserengine, bestanden.
- 10 ergänzende Prüfungen für Anlagen, Dateiauswahl, leere Daten, verzögerte Antworten, lokale Speicherung und Kalender-Rückkehr bestanden.
- 65 gezielte Aufgaben-, Kalender-, Serien- und Adaptertests bestanden.
- Alle 233 JavaScript-Blöcke der Auslieferung lassen sich parsen; die Anzahl der insgesamt 315 Scriptblöcke bleibt unverändert.

Die Browserprüfungen bedienen die echte ausgelieferte Anwendung mit synthetischen Fällen, Aufgaben und abgefangenen Serverantworten. Die lokale Speicherung verwendet den echten lokalen Adapter. Es wurden keine echten Falldaten verändert und keine echten Dateien an externe Aufgabenanbieter übertragen. Die vorhandenen Vikunja-/OpenProject-Adapter werden zusätzlich durch ihre Tests abgedeckt.

Gesamtsuite nach der gesondert beauftragten Fehlerbehebung am 10.09.2026: **1371 Prüfungen bestanden, 0 Fehler, 0 übersprungen**. Die zuvor gemeldeten 17 Ausfälle wurden behoben: 15 veraltete Strukturprüfungen, eine überholte Mobil-Registry-Erwartung und die instabile Testserver-Anbindung. Die gemeinsame Strukturprüfung prüft weiterhin alle 233 JavaScript-Blöcke sowie die Vollständigkeit und eindeutigen Kennungen des Auslieferungsbestands. Die Statusprüfung besteht jetzt auch einzeln mit eigener Testvorbereitung. Ursachen und Nachweise stehen in [Fehlerbehebung der Gesamtsuite](suite-fehlerbehebung.md); der vollständige neue Lauf steht in `gesamtsuite-korrigiert.txt`. Die ursprünglichen Fehlerprotokolle bleiben zur Nachvollziehbarkeit erhalten.

Protokolle: `browser-chromium.txt`, `browser-webkit.txt`, `sonderfaelle.txt`, `gezielte-tests.txt`, `gesamtsuite.txt`, `ausgangsstand-tests.txt`, `statusabfrage-wiederholung.txt`.

Kein Commit, Push oder Eingriff in Main in diesem Arbeitsschritt.
