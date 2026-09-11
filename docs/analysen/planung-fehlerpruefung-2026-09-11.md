# Fehlerprüfung: Kalender, Aufgaben, Fristen und Wiedervorlagen

Stand: 11. September 2026. Ausgangspunkt: `9dc2a00`.

## Behobene Fehler

- **Lokaler Kalender:** Neuanlage und Löschen verschluckten Speicherfehler. Der Vorgang konnte als erfolgreich erscheinen, obwohl der Browser die Änderung nicht gespeichert hatte. Beide Wege verlangen jetzt eine bestätigte Speicherung. Beim Bearbeiten eines inzwischen gelöschten Termins erscheint ebenfalls ein Fehler.
- **Begrenzte Serien:** Aufgaben und Wiedervorlagen mit einer importierten Wiederholungsanzahl (`COUNT`) liefen unbegrenzt weiter. Nach jedem Abschluss wird die verbleibende Anzahl mitgespeichert; das letzte Vorkommen wird erledigt. Ungültige Fälligkeitswerte erzeugen keine neue Serieninstanz.
- **Abhaken in der Seitenleiste:** Serienaufgaben wurden dort unmittelbar erledigt, während andere Ansichten die nächste Fälligkeit erzeugten. Aufgabenliste, Kalender, Seitenleiste und Wiedervorlagen verwenden nun denselben Abschlussweg.
- **Abschlussdokumentation:** Der Serienabschluss wird erst nach erfolgreicher Speicherung dokumentiert. Auch die Wiedervorlagenansicht nutzt diesen Weg.
- **Rückgängig bei Wiedervorlagen:** Datum und Wiederholungsanzahl werden gemeinsam zurückgesetzt. Änderungen an Serie, Eintragstyp und Quellenzuordnung werden bei der Konfliktprüfung berücksichtigt. Fehlende alte Feldwerte werden ausdrücklich zurückgesetzt, statt beim Online-Aufruf wegzufallen.
- **Fristverknüpfungen:** Der lokale Abgleich bestätigt den geschriebenen Inhalt, bevor er die Kalender- oder Aufgabenkennung an der Frist hinterlegt. Wirkungslose Schreibversuche bleiben als ausstehender Abgleich sichtbar und können erneut versucht werden.

## Prüfung

- Ausgangsprüfung: 84 gezielte automatisierte Tests erfolgreich.
- Bestehende Browserprüfungen für alle vier Bereiche erfolgreich, ausschließlich mit fiktiven Daten und abgefangenen Netzaufrufen.
- Abschließende gesamte Serversuite: **1.402 Tests erfolgreich, 0 Fehler**.
- Neue bereichsübergreifende Browserprüfung: **je 9 Prüfungen in Chromium und WebKit erfolgreich**. Sie umfasst Serienabschluss, Rückgängig, Konflikte, Seitenleistenaktion, Abschluss im Kalender, Rückkehr zur Wiedervorlage sowie einen lokalen Speicherfehler mit anschließendem erneutem Speichern.
- Desktop- und Mobilansichten der neuen Browserprüfung visuell kontrolliert. Keine neuen JavaScript-Laufzeitfehler.
- Änderungen auf überflüssige Leerzeichen und unbeabsichtigte Dateiveränderungen geprüft.

Die Prüfungen verwenden keine echten Falldaten. Externe Kalender- und Mailanbieter wurden in diesem Durchlauf nicht live angesprochen. Die Änderungen sind lokal im Projekt gespeichert.

## Prüfstände

- `server/tests/planning-regressions.test.cjs`
- `server/tests/html-fristen-workspace.test.cjs`
- `server/scripts/qa-planning-regressions.cjs`, aufrufbar über `PLANNING_REGRESSION_AUDIT=1` mit dem bestehenden Wiedervorlagen-Prüfstand.

## Ergänzende Prüfung der Wiedervorlagen

- **Aktualisieren:** Nach dem Schließen eines Details öffnete eine Aktualisierung den zuvor gewählten Eintrag erneut. Die Listenansicht bleibt jetzt erhalten. Ein ausdrücklich geöffnetes Detail sowie der geöffnete Filter mit noch nicht angewendeter Auswahl bleiben beim Aktualisieren ebenfalls erhalten.
- **Veraltete Direktverweise:** Wenn ein angefragter Eintrag nicht mehr existiert, wird die Liste angezeigt. Zuvor konnte stattdessen ein anderer, früher ausgewählter Eintrag erscheinen.
- **Tastaturbedienung:** Nach dem Zurücksetzen des Filters bleibt der Fokus auf der Schaltfläche. Escape schließt den Filter und führt zum Auslöser zurück. Auch Aktualisieren stellt den Fokus nach dem Neuladen wieder her.
- **Datum von E-Mail-Wiedervorlagen:** Die Seitenleiste verwendete bei Zeitangaben mit Zeitzone den UTC-Kalendertag. Termine kurz nach Mitternacht konnten dadurch am Vortag oder fälschlich als überfällig erscheinen. Seitenleiste und Detail verwenden jetzt denselben lokalen Kalendertag.

Verifikation: Der neue Prüfstand `server/scripts/qa-followup-regressions.cjs` besteht mit jeweils **9 Prüfungen in Chromium und WebKit** (Aufruf über `FOLLOWUP_REGRESSION_AUDIT=1`). Zusätzlich bestehen die vorhandenen WebKit-Prüfungen für das automatisch und manuell skalierbare Notizfeld sowie die bereichsübergreifenden Planungsabläufe. Desktop, mobile Darstellung und Dark Mode wurden kontrolliert. Die gesamte Serversuite wurde anschließend erneut erfolgreich ausgeführt: **1.402 Tests, 0 Fehler**. Von der Testsuite erzeugte Änderungen an PDF-Vorlagen wurden entfernt.
