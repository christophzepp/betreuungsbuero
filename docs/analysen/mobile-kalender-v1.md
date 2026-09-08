# Mobile Umstellung: Kalender

Der Kalender ist als erster Einzelumbau aus Schritt 2 umgesetzt. Stand: 07.09.2026, Release v0.7.7 (`9b28c434343743b116da66f37cb88d0b7cbc2019`) mit dem bereits vorhandenen mobilen Fundament, Aufgabenpilot und ersten Modulpaket. Die Änderungen liegen lokal auf `codex/mobile-foundation-chats` und sind nicht veröffentlicht.

[Galerie der umgesetzten Ansichten](mobile-kalender-v1/ansichten.html)

## Bedienung

Die mobile Startansicht zeigt eine Tagesagenda mit Wochenleiste. Kopfzeile, flache Eintragslisten, Terminseite, Formular, Filterblatt und feste Formularaktionen verwenden dieselben Bausteine wie Dokumentation und Aufgaben. Die Navigation mit Chats und Mitarbeiterchat-Badge folgt weiterhin dem vereinbarten Standard: beim Abwärtsscrollen ausblenden, beim Aufwärtsscrollen sowie oben und beim Menüwechsel anzeigen, bei geöffneter Tastatur ausblenden.

| Zugang | Erhaltener bzw. angepasster Funktionsumfang |
| --- | --- |
| Tag | Wochentage direkt wählen, vorheriger/nächster Tag, Heute, Tagesagenda |
| Woche | Tagesgruppen und Wochenwechsel; Wochenendeneinstellung aus dem bestehenden Kalender |
| Monat | Kompakte Monatsübersicht mit 42 auswählbaren Tagen, Trefferpunkten und Agenda des gewählten Tages |
| Liste | Tag, Monat, Jahr, alle Termine oder eigener Zeitraum mit Von/Bis; bestehende Einstellungen für vergangene Termine, Metadaten und kompakte Zeilen |
| Suche | Vorhandene Suche über Titel, Ort, Notiz und Fall; Eingabe bleibt beim Filtern bestehen |
| Filter | Fall-ID, Kalender, Eintragsart und Schlagwort; Eintragsarten Termine, Aufgaben, Fristen und Wiedervorlagen |
| Kalender und Listen | Vorhandene Sichtbarkeit und Farben einschließlich lokaler und angebundener Kalender sowie eingeblendeter Aufgabenlisten |
| Terminseite | Titel, Beginn/Ende, Ganztag, Fall, Kalender, Erinnerung, Wiederholung, Notiz, Karten-/Online-Link, Anlagen und vorhandene Ursprungsreferenzen |
| Terminaktionen | Bearbeiten, Verschieben, ICS-Einzelexport und Löschen; Serienaktionen ausdrücklich für die gesamte Serie gekennzeichnet |
| Formular | Alle ursprünglichen Felder: Titel, Fall, Anfangs-/Enddatum und Uhrzeit, Ganztag, Erinnerung, Ort, Online-Link, Verbindung/Kalender, Farbe, Notiz, Wiederholungsart/-intervall/-ende sowie Anlagen |
| Neuanlage | Plus-Schaltfläche; bestehende Fall- und Kalenderzuordnungen; Originalspeicherweg einschließlich verknüpfter Planungsaktionen |
| Verschieben | Datum und Uhrzeit als Touch-Eingabe; Dauer und Erinnerungsabstand bleiben erhalten; ganztägige Mehrtagstermine behalten ihre Zahl an Kalendertagen über Zeitumstellungen |
| Werkzeuge | Neu laden, Synchronisieren, ICS-Import und ICS-Export der Termine im bestehenden Fallfilter |
| Querverbindungen | Eingeblendete Aufgaben, Fristen und Wiedervorlagen öffnen weiterhin die bestehende Aufgabenbearbeitung mit der ursprünglichen Datensatz-ID |

Das bisherige Planungsraster bleibt über „Mehr“ erreichbar. Es bewahrt die vorhandenen Rasterfunktionen und Einstellungen, etwa Zeitfenster, Stundenhöhe, Wochenenden und Monatsdarstellung. Breite Raster sind horizontal scrollbar. Das Verschieben bietet zusätzlich einen eigenen Touch-Ablauf. Es wurde kein neuer Kalender-Datenspeicher eingeführt.

Beispiel-Filter aus dem Mockup wie „Teilnahme“ werden nicht als neue Felder erfunden. Die Filter arbeiten mit den tatsächlich vorhandenen Kalenderdaten. Bei einem vorhandenen Termin wird der reale Speicherort angezeigt und beibehalten: Die bestehende PUT-Schnittstelle unterstützt keinen Wechsel der Verbindung bzw. des Kalenders. Bei neuen Terminen bleiben diese Auswahlen verfügbar.

## Entwürfe und Fehlerfälle

- Das Formular verwendet die ursprünglichen Eingabeelemente, neu angeordnet in mobile Abschnitte. Hintergrundaktualisierungen ersetzen einen offenen Entwurf nicht.
- Abbrechen, Schließen und Menüwechsel schützen geänderte Eingaben. Ein Chat-Ausflug erhält die tatsächlichen Formularfelder. Während eines Speichervorgangs ist auch der Wechsel in KI- oder Mitarbeiterchat gesperrt.
- Abgelehnte Speicherungen lassen das Formular mit verständlicher Fehlermeldung offen.
- Ein neu gespeicherter Termin behält seine ID, wenn anschließend ein Anlagen-Upload fehlschlägt. Ein erneutes Speichern lädt die ausstehenden Dateien am selben Termin hoch.
- Fehlgeschlagene Anlagen-Uploads bei vorhandenen Terminen bleiben ebenfalls für einen erneuten Versuch ausgewählt. Anlagenaktionen verändern nur den Anlagenbereich und erhalten die übrigen Eingaben.
- Abgelehnte Löschungen werden angezeigt; Termine und Anlagen bleiben sichtbar.
- Bei Ladefehlern bleiben bereits geladene Termine sichtbar und können erneut geladen werden.
- Datumsvalidierung berücksichtigt den inklusiven Endtag im Ganztagsformular und das exklusive Ende im gespeicherten Kalenderformat. Die vorhandene Aufteilung von Mehrtagsterminen und Serien wird weiterverwendet.

Die Desktopdarstellung bleibt der bisherige Kalender. Die gemeinsame Fehlerbehandlung prüft jetzt auch die Serverantwort bei Termin- und Anlagenlöschungen.

## Prüfstand

| Prüfung | Ergebnis |
| --- | --- |
| Kalender im Browser | 46 Prüfungen erfolgreich |
| Mobile und Kalender-Tests | 103 Tests erfolgreich, einschließlich vier neuer Verhaltenstests für Filter, Datumsgrenzen und Verschieben |
| Aufgaben-Regression | 42 Browserprüfungen erfolgreich |
| Erstes Modulpaket | 61 Browserprüfungen erfolgreich |
| Navigation | 23 Browserprüfungen erfolgreich |
| Dokumentation und Chats | 28 erfolgreiche Prüfschritte einschließlich Abschlussmeldung |
| JavaScript | 229 ausführbare Blöcke syntaktisch gültig; 311 Script-Blöcke insgesamt |
| Vollständige Suite | 1.236 Tests: 1.232 erfolgreich, drei fehlgeschlagen, einer übersprungen |

Die drei Fehler der vollständigen Suite entsprechen den bereits am unveränderten Release nachgewiesenen Fehlern: Backup-Registrierung und Recovery-Bootstrap für `office_ai_config.allowed_models` sowie V230-PDF-Golden-Rendering. [Vorhandener Baseline-Nachweis](mobile-fundament-v1/baseline-fehler.txt).

Die Browserläufe verwenden die echte ausgelieferte HTML-App mit synthetischen Daten und abgefangenen Serverzugriffen. Geprüft wurden die Abläufe einschließlich Serien, Zuordnungen, Anlagenfehlern, Chat-Rückkehr und ICS-Downloads sowie Hell/Dunkel bei 320–430 px. Die Tastaturprüfung simuliert einen verkleinerten VisualViewport. Die Prüfung mit physischen Smartphones, tatsächlichen Kalenderanbietern und echten Mehrbenutzerkonten steht noch aus. Produktionsdaten wurden nicht geschrieben.

## Nachweise und Fortsetzung

[Browserprüfungen](mobile-kalender-v1/browser-pruefung.txt) · [Gezielte Tests](mobile-kalender-v1/gezielte-tests.txt) · [Gesamtsuite](mobile-kalender-v1/vollstaendige-testsuite.txt) · [Syntax](mobile-kalender-v1/syntax-pruefung.txt)

[Aufgaben](mobile-kalender-v1/aufgaben-regression.txt) · [Modulpaket](mobile-kalender-v1/modulpaket-regression.txt) · [Navigation](mobile-kalender-v1/navigation-regression.txt) · [Dokumentation und Chats](mobile-kalender-v1/fundament-regression.txt)

Reproduktion: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright node server/scripts/qa-mobile-calendar.cjs`. Verhaltenstests: `node --test server/tests/html-mobile-calendar.test.cjs`.

Als nächster Einzelumbau folgt E-Mail mit eigenem Ablauf für Ordner, Nachrichtenliste, Lesen, Verfassen/Antworten/Weiterleiten, Anlagen und Entwurfsschutz. Datei-Explorer, Banking, Rechnungen und weitere Finanzmodule bleiben anschließend separate Etappen entsprechend dem [ersten Modulpaket](mobile-modulpaket-1-v1.md).
