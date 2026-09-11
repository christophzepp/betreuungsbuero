# Wiedervorlagen: GUI-Korrektur

Stand: 11. September 2026. Korrektur am tatsächlichen Programm.

## Behobene Fehler

- **Abgeschnittene Inhalte:** Mobile Listen und einspaltige Detail-, Filter- und Formularansichten wuchsen über ihren sichtbaren Bereich hinaus. Der übergeordnete Bereich schnitt sie ab. Die vorgesehenen Inhaltsbereiche haben jetzt eine begrenzte Höhe und scrollen selbst bis zum letzten Eintrag bzw. zur letzten Schaltfläche.
- **Falsche Scrollposition:** Neue Formular- und Detailansichten beginnen oben. Bei der Auswahl eines Originals bleiben dagegen Scrollposition und Tastaturfokus erhalten.
- **Zu große Originalauswahl:** Auch bei vielen Dokumenten bleibt die Auswahl kompakt und besitzt einen eigenen Scrollbereich. Auswahl per Maus, Touch und Tastatur bleibt möglich.
- **Überdimensioniertes Notizfeld:** Eine allgemeine Vorgabe setzte das Feld auf 420 Pixel Höhe. Das Wiedervorlagenformular verwendet jetzt 110 Pixel als Ausgangshöhe; manuelles Vergrößern bleibt möglich.
- **Lange Namen und Pfade:** Fallbezeichnungen, Filter-Chips und Originalpfade brechen innerhalb ihrer Bereiche um. Die Fußzeile bleibt kompakt; der vollständige Fallname ist dort über den Tooltip verfügbar. Lange Untertitel belegen höchstens zwei Zeilen und haben ebenfalls einen Tooltip.
- **Detailaktionen:** Die vier Hauptaktionen behalten ihr Raster. „Serie, Anlagen & weitere Optionen“ nutzt eine eigene volle Zeile.
- **Fehlende Originalangaben anderer Fälle:** Die zentrale Quellensammlung hing fälschlich vom gewählten Fall der Fallübersicht ab. Im Wiedervorlagenmenü berücksichtigt sie jetzt sämtliche zugänglichen Fälle; die normale Fallübersicht behält ihre Auswahl. Dateiname und Pfad anderer Fälle werden dadurch richtig angezeigt.

## Validierung dieses Korrekturlaufs

- **55 Layoutprüfungen in Chromium und 55 in WebKit bestanden.** Desktop mit Maus sowie mobile Bedienung mit Touch; Breiten 320, 390, 600, 768, 844, 1024 und 1440 Pixel, einschließlich niedriger Fenster mit 390/420 Pixel Höhe und Dunkelmodus.
- Die Scrollprüfungen bewegen ausdrücklich den vorgesehenen Inhaltsbereich und prüfen Position sowie Sichtbarkeit der letzten Schaltfläche. Automatisches Scrollen eines Klick-Werkzeugs ersetzt diese Prüfung nicht.
- Große Listen, viele Originale, lange zusammenhängende Fallnamen, echte Dateipfade aus einem zweiten Fall, kompakte Notizfelder und Tastaturfokus sind als Regressionen abgedeckt.
- **40 bestehende Bedienprüfungen pro Browser bestanden:** Anlegen, Bearbeiten, Speichern, Rückgängig, Verschieben, Erledigen/Wiederöffnen, Löschen, Dublettenschutz, Serien, lokale Speicherung, E-Mail-Zurückstellung und Schutz ungespeicherter Eingaben.
- **30 gezielte Tests bestanden:** 13 für Wiedervorlagen und Quellen einschließlich normaler Fallauswahl, 17 für die mobile Modul-Einbindung. Alle ausgelieferten Skripte kompilieren.
- Keine neuen JavaScript-Laufzeitfehler; keine Whitespace-Fehler im Diff. Sichtkontrolle der erzeugten Desktop- und Mobilbilder in Hell und Dunkel.

Die Browserprüfungen verwenden ausschließlich synthetische Daten und abgefangene Serveranfragen. Ergebnisse und ausgewählte Bildschirmbilder liegen in diesem Ordner.

Änderungen sind lokal; kein Push.
