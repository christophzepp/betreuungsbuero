# Fehlerkorrektur im Fristen-Menü

Stand: 10. September 2026. Nachprüfung der neuen produktiven Oberfläche auf Wunsch des Nutzers.

## Behobene Fehler

- **Speichern mit Enter:** Der Speichern-Knopf ist jetzt mit dem Formular verbunden. Enter speichert genau einmal; ungültige Eingaben bleiben zur Korrektur stehen.
- **Verlorene Dokumentenprüfung:** Ausgewählte Dateien und korrigierte Erkennungsergebnisse werden beim Schließen, bei Escape und bei einem mobilen Bereichswechsel vor dem Verwerfen geschützt. Aktualisieren erhält die offene Prüfung.
- **Abgebrochener Bereichswechsel:** Nach dem bestätigten Verwerfen öffnet sich der zuvor gewählte Filter, die Dokumentenerkennung oder die angeklickte Frist. „Weiter bearbeiten“ erhält die tatsächlichen Formularfelder, ihren Inhalt und die Scrollposition.
- **Teilweise gespeicherte Erkennung:** Zielfall und Dateien bleiben nach Beginn der Übernahme festgelegt. Ein erneuter Versuch verwendet die bereits angelegten Fristen und erzeugt keine Dubletten.
- **Lokale Eintragskennungen:** Gemischt als Zahl oder Text gespeicherte Kalenderkennungen werden erkannt. Vorhandene Einträge werden einschließlich ihrer Anlagen aktualisiert und beim Entfernen korrekt gefunden.
- **Mobile Oberfläche:** Die doppelte Überschrift entfällt in Unteransichten. Speichern und Abbrechen stehen in einer gemeinsamen Zeile. Vergangene Erfolgshinweise verschwinden beim Öffnen eines anderen Bereichs. Dadurch bleibt mehr Platz für die Formularfelder.
- **Fehleraktionen:** „Abgleich wiederholen“ steht deutlich über Bearbeiten und Löschen. Solange der Abgleich unvollständig ist, erscheint keine irreführende Erledigen-/Wiederöffnen-Aktion. Lange Fallnamen dürfen umbrechen. Die Verwerfen-Beschriftung passt auch auf sehr schmale Bildschirme.

## Prüfung

- Gesamtsuite: **1.381 bestanden, 0 fehlgeschlagen**.
- Fristen-Browserprüfung: **je 114 erfolgreiche Prüfungen** in Chromium und WebKit, 320–1440 Pixel, Hell und Dunkel.
- Zusätzliche visuelle Prüfung: **je 5 erfolgreiche Prüfungen** der Fehleraktionen und Formularbedienung, einschließlich 320 × 568 Pixeln.
- Der echte Programmcode wurde verwendet. Fälle, Serverantworten und KI-Erkennungsergebnisse waren kontrollierte Testdaten; externe Schreibzugriffe wurden abgefangen.

[Prüfergebnisse](nachpruefung/pruefergebnisse.json) · [Mobile Formularansicht](nachpruefung/webkit/formular-kleines-display.png) · [Fehleraktionen am Desktop](nachpruefung/webkit/abgleich-desktop.png) · [Entwurfsschutz mobil](nachpruefung/webkit/entwurf-behalten-mobil.png)

Die Änderungen sind lokal. Es wurde nichts gepusht; Main bleibt unverändert.
