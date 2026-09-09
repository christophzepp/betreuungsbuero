# Kalenderdesign: Umsetzung und Funktionsabgleich

Stand: 9. September 2026. Das freigegebene Design ist in der tatsächlichen Anwendungsdatei `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html` umgesetzt. Der Kalender verwendet weiterhin seine bestehenden Datensätze, Fallkennungen, lokalen Speicher und Serverendpunkte. Die Aufnahmen zeigen die laufende Anwendung mit künstlichen Testdaten.

[Ansichten ansehen](kalender-design-v1/ansichten.html)

## Oberfläche

Der Desktopkalender besitzt jetzt eine Seitenleiste mit Fallauswahl, Mini-Kalender, Kalendern, Eintragsarten und Aufgabenlisten. Navigation, Suche, Ansichtsoptionen und Werkzeuge stehen über dem Kalender. Termin- und Aufgabendetails sowie Bearbeitung öffnen in einem seitlichen Bereich. Kleine Fenster zeigen einen kompakten Monat mit 42 Tagen und der Agenda darunter; Tag und Woche wechseln zur Agenda, das Planungsraster bleibt ausdrücklich wählbar. Die vorhandene mobile Navigation bleibt eingebunden.

Die Gestaltung übernimmt die ruhige Farbgebung, Pastellflächen, Abstände und Aufteilung des korrigierten Entwurfs. Kalender- und Terminfarben, aktive Filter und Fallbezüge bleiben sichtbar. Bestehende persönliche Ansichtsoptionen werden weiterverwendet.

## Funktionsabgleich

| Funktionsgruppe | Umsetzung und Prüfung |
| --- | --- |
| Tag, Woche, Monat, Liste | Alle vier Ansichten; Heute, Vor/Zurück, Mini-Kalender, Tagesauswahl und KW-Sprung erhalten. |
| Suche und Filter | Titel, Ort, Notiz und Fall; Fallkennungen, Schlagwort, kombinierbare Eintragsarten, einzelne Kalender und Aufgabenlisten. Aktive Einschränkungen sind einzeln entfernbar. |
| Sichtbarkeit und Farben | Lokale und verbundene Kalender, Aufgaben, Fristen und Wiedervorlagen; alle/keine, Standardfarbe, persönliche Listenfarben und Zurücksetzen. Zusätzlich eigene Terminfarbe oder Kalenderfarbe. |
| Monatsraster | Mehrtagesbalken, Kalenderwochen, 2/3/4/alle Zeilen, Fortsetzungstitel, bündige Einzeltermine, Zeilentreue und Zeilennummern erhalten. Ein Klick auf einen Termin öffnet seine Details; Tageszellen wählen weiterhin den Tag aus. |
| Zeitraster | Ganztag, Mehrtag, Zeitfenster, Stundenhöhe, Wochenenden, Fortsetzungstitel und Drag-and-drop mit Zielvorschau. Gleichzeitige Termine teilen sich die Spaltenbreite. Termine außerhalb des Zeitfensters bleiben sichtbar. |
| Liste | Tag, Monat, Jahr, alle oder eigener Zeitraum; Von/Bis, Mini-Kalender, Zeitraum-Navigation und Zurücksetzen. Vergangene Einträge, Zusatzzeilen und kompakte Darstellung bleiben einstellbar. |
| Terminformular | Titel, Fall, Beginn/Ende, Ganztag, Erinnerung, Ort, Online-Link, Kalender/Verbindung, Farbe und Notiz. Der bestehende Speicherort bleibt beim Bearbeiten gesperrt, entsprechend dem Serververtrag. |
| Wiederholung | Täglich, wöchentlich, monatlich, jährlich, Intervall und Enddatum. Eine vorhandene Begrenzung der Serienanzahl bleibt beim Speichern erhalten. Details zeigen das angeklickte Vorkommen; Bearbeiten, Verschieben und Löschen wirken ausdrücklich auf die Serie. |
| Anlagen | Ansehen, hinzufügen, entfernen, vor der Neuanlage auswählen und aus dem Datei-Explorer übernehmen. Uploadfehler behalten ausstehende Dateien; erneutes Speichern verwendet dieselbe Kennung. |
| Verschieben | Ziehen im Zeit- oder Monatsraster sowie Datum-/Zeitdialog ohne Ziehen. Dauer und Erinnerung werden mitgeführt; ganztägige Dauer bleibt über Zeitumstellungen erhalten. |
| Aufgaben, Fristen, Wiedervorlagen | Ursprüngliche Datensätze öffnen und bearbeiten; erledigen, wieder öffnen, löschen und zurück zum Kalender. Wiederkehrende Aufgaben nutzen die vorhandene Fortschaltung. Anlagen, Fallbezug und Ursprungsreferenzen bleiben erhalten. |
| ICS und Synchronisierung | Vorhandener Import, Gesamtexport mit Fallfilter, Einzelexport, Neu laden und Kalender synchronisieren sind angebunden. |
| Sicherheit der Eingaben | Datums-/Zeit- und Seriengrenzen validieren; Entwürfe bei Aktualisierung, Dateiauswahl und Breitenwechsel erhalten; beim Verlassen nachfragen; während des Speicherns Doppelaktionen sperren. |
| Hell/Dunkel, Mobilität und Tastatur | Darstellung an die App-Einstellung angepasst; kompakte Ansichten bis 320 Pixel; zugängliche Beschriftungen, Tastaturbedienung für Rastereinträge und Fokusbegrenzung im Terminbereich. |

## Behobene Fehler

- Gleichzeitige Termine verdeckten einander. Sie erhalten jetzt getrennte Spalten.
- Die alte Dunkelgestaltung zeichnete Stundenlinien fest im 48-Pixel-Abstand. Raster, Termine und Drag-and-drop verwenden jetzt dieselbe eingestellte Stundenhöhe.
- Ziehen verschob die Erinnerung nicht mit. Der bestehende, für Zeitumstellungen geprüfte Verschiebeweg wird nun auch am Desktop verwendet.
- Fehlgeschlagene Desktop-Uploads konnten Dateiauswahl oder ungespeicherte Notizen verlieren. Anlagen werden getrennt aktualisiert und am selben Datensatz erneut hochgeladen.
- Das Bearbeiten eines Termins ohne Erinnerung konnte ungewollt eine Standarderinnerung ergänzen. Ein leerer Wert bleibt leer.
- Beim Bearbeiten einer begrenzten Serie konnte deren Anzahl verloren gehen. Die Begrenzung bleibt erhalten.
- Monatsauswahl und KW-Sprung konnten für anschließende Aktionen einen veralteten Bezugstag verwenden. Die Datumszustände werden gemeinsam aktualisiert.
- Serien-Details konnten den Beginn der Serie statt des angeklickten Vorkommens zeigen. Datum und Erinnerung beziehen sich nun auf das gewählte Vorkommen.
- Größenwechsel konnten frisch geöffnete Details ersetzen oder den falschen Speicherablauf für ein bereits offenes Formular wählen. Laufende Ansichtswechsel werden verworfen, und das Formular behält seinen Speicherablauf bis zum Abschluss.
- Ganztagstitel, lange Texte, schmale Monatsansichten, Einzahl/Mehrzahl, Wiederholungsintervalle und der Rückweg aus Aufgaben wurden korrigiert.

## Prüfergebnisse

- **30 gezielte Tests erfolgreich:** Monatsraster, Belegung, Ansichtsoptionen, Spaltenbreiten, Farbwerte, Serienanzahl, Datumsvalidierung, kombinierte Filter und Zeitumstellungen.
- **110 Browserprüfungen erfolgreich:** 36 Desktopprüfungen, 15 Zusatzprüfungen und 59 mobile Prüfungen. Darunter echte Formularbedienung, lokale Speicherung, simulierte Serverfehler, Anlagen, Aufgabenstatus, ICS-Downloads, Größenwechsel und Hell/Dunkel. Keine JavaScript-Laufzeitfehler in diesen Prüfläufen.
- **Gesamtsuite: 1.348 erfolgreich, 17 fehlgeschlagen, insgesamt 1.365.** Alle 17 Fehler treten auch am unveränderten Ausgangsstand auf. Sie betreffen überwiegend veraltete Erwartungen an die Anzahl der Skriptblöcke und ältere Menü-/Modul-Erwartungen. Es kamen keine neuen Fehler hinzu. Ein zuvor schwankender Backup-Test war bei der Einzelwiederholung und im abschließenden Gesamtlauf erfolgreich.
- Ein Vergleich der vollständigen Anwendungsdatei bestätigt: Außer dem bestehenden Kalender-/Aufgabenskript und einem ausschließlich dafür geltenden Stilblock wurde kein anderer Anwendungscode verändert. Beim Testlauf erzeugte PDF-Prüfdateien wurden auf ihren vorherigen Stand zurückgesetzt.

Die Browserprüfungen verwenden künstliche Daten und abgefangene Serverzugriffe. Die vorhandenen Anbieterwege wurden auf Aufruf und UI-Verhalten geprüft; es wurde keine Live-Synchronisierung mit einem persönlichen Kalenderkonto ausgeführt.

[Desktopprotokoll](kalender-design-v1/desktop-pruefung.txt) · [Mobile Prüfungen](kalender-design-v1/mobile-pruefung.txt) · [Zusatzprüfungen](kalender-design-v1/zusatzpruefung.txt) · [Gezielte Tests](kalender-design-v1/gezielte-tests.txt) · [Gesamtsuite](kalender-design-v1/gesamtsuite.txt) · [Ausgangsstand](kalender-design-v1/ausgangsstand-gesamtsuite.txt) · [Fehlerabgleich](kalender-design-v1/baseline-vergleich.json)

Reproduzierbare Browserprüfungen: `server/scripts/qa-calendar-design.cjs` und `server/scripts/qa-mobile-calendar.cjs`. Der Zusatzlauf wird über `CALENDAR_QA_EXTRA=1` aktiviert; `PLAYWRIGHT_MODULE` kann auf eine lokal installierte Playwright-Ausgabe zeigen.

Veröffentlichungsziel ist der Beta-Kanal über `develop`. Der zugehörige GitHub-Workflow prüft den Containerstart und veröffentlicht das Beta-Image für AMD64 und ARM64. `main` bleibt unverändert.
