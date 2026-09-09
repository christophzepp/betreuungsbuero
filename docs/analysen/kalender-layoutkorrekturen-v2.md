# Kalender: Korrekturen nach den Screenshots

Stand: 9. September 2026. Ausgangsstand: Beta-Commit `1f3df55`. Veröffentlichungsziel der Korrekturen ist der Beta-Kanal über `develop`. `main` bleibt unverändert.

[Korrigierte Ansichten ansehen](kalender-layoutkorrekturen-v2/ansichten.html)

## Änderungen

- **Buttons:** Tag, Woche, Monat und Liste bilden vier gleich breite, gleichzeitig sichtbare Felder. Die Aktionen im rechten Detailbereich stehen in zwei gleichmäßigen Reihen; der Rückweg folgt darunter. Beim Öffnen der Details schließen sich noch offene Kalender-Menüs.
- **Tag:** Eine Tagesüberschrift für alle Einträge desselben Tages. Die Überschrift wird nicht mehr vor jedem einzelnen Eintrag wiederholt.
- **Woche:** Schmale Desktopfenster und Smartphones erhalten eine eigene Wochenübersicht mit Tagesspalten. Die Wochentagsleiste zeigt Datum und Eintragszahl und springt zur gewünschten Spalte. Seitliches Scrollen erreicht die weiteren Tage; der Tagesname öffnet den entsprechenden Tag. Leere Tage bleiben sichtbar. Die Einstellung zum Ausblenden der Wochenenden und das zusätzliche Planungsraster bleiben erhalten.
- **Liste:** Zeitraum-Auswahl, Von/Bis und Eintragszahl passen sich an die Fensterbreite an. Die Zeilen sind nach Datum gruppiert und kompakter gestaltet. Direkte Datumseingaben öffnen keinen zusätzlichen Kalender über der Liste; der Mini-Kalender bleibt über seinen Button bedienbar. Datumsfelder und Dunkelmodus wurden mit WebKit geprüft.
- **Symbole:** Termin, Aufgabe, Frist und Wiedervorlage besitzen gemeinsame SVG-Symbole. Sie erscheinen in den Filtern, am kleinen Kalender, im Monats- und Zeitraster, in den Tages-, Wochen- und Listenansichten sowie in den Kalenderdetails. Doppelte Typ-Präfixe werden in den angezeigten Kartenüberschriften entfernt; gespeicherte Titel bleiben unverändert. „Wiedervorlage“ wird auf kleinen Breiten sinnvoll umgebrochen.

Die Screenshots des Nutzers zeigen die Desktopoberfläche in einem schmalen Safari-Fenster. Deshalb wurden sowohl diese Oberfläche als auch die eigenständige Smartphoneoberfläche geprüft.

## Prüfung

- **33 gezielte automatisierte Tests bestanden.** Einschließlich neuer Prüfungen für einmalige Tagesüberschriften, leere Wochentage und die Zuordnung der Symbole zur Eintragsart. Alle Skriptblöcke der Anwendungsdatei bleiben syntaktisch gültig.
- **110 vorhandene Browserprüfungen bestanden:** 36 Desktopprüfungen, 59 mobile Prüfungen und 15 Zusatzprüfungen. Darunter Speichern, Anlagen, Aufgaben, Wiederholungen, Filter, Größenwechsel, lokale Speicherung und Zeitumstellungen.
- **44 gezielte WebKit-Prüfungen bestanden:** 26 für Desktop und schmale Fenster, 18 für die Smartphoneoberfläche. Geprüfte Breiten: 320, 390, 430, 600 und 820 Pixel sowie der breite Desktop. Alle vier Ansichtsbuttons müssen gleichzeitig im sichtbaren Bereich liegen. Wochenkarten öffnen den ursprünglichen Datensatz; Zeitraumfelder und Mini-Kalender bleiben erreichbar. Keine JavaScript-Laufzeitfehler in diesen Prüfläufen.
- Bilder der tatsächlichen Anwendung wurden zusätzlich visuell kontrolliert. Dabei wurden ein Farbkonflikt der mobilen Wochenleiste, der unpassende Wortumbruch und eine übergeordnete Mobil-Regel für die Ansichtsbuttons korrigiert.
- Ein vollständiger Vergleich bestätigt: In der Anwendungsdatei wurden ausschließlich das Kalender-/Aufgabenskript und der zugehörige Kalender-Stilblock geändert. Bestehende Datenwege und Speicherformate bleiben erhalten.

Die Prüfungen verwenden künstliche Daten und abgefangene Serverzugriffe. Es wurden keine persönlichen Kalenderdaten verändert.

[Gezielte Tests](kalender-layoutkorrekturen-v2/gezielte-tests.txt) · [Desktop](kalender-layoutkorrekturen-v2/desktop-regression.txt) · [Mobil](kalender-layoutkorrekturen-v2/mobile-regression.txt) · [Zusatzprüfungen](kalender-layoutkorrekturen-v2/zusatzpruefungen.txt) · [WebKit: schmale Fenster](kalender-layoutkorrekturen-v2/webkit-schmale-fenster.txt) · [WebKit: Smartphone](kalender-layoutkorrekturen-v2/webkit-mobil.txt)

Die gezielten Browserprüfungen werden über `CALENDAR_QA_FEEDBACK=1` in `server/scripts/qa-calendar-design.cjs` bzw. `server/scripts/qa-mobile-calendar.cjs` gestartet. `MOBILE_QA_BROWSER=webkit` wählt die Safari-Browserengine; `PLAYWRIGHT_MODULE` kann die installierte Playwright-Ausgabe angeben. Die gemeinsamen Prüfschritte stehen in `server/scripts/qa-calendar-layout-feedback.cjs`.
