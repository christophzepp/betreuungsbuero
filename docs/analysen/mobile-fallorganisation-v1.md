# Mobile Fallorganisation: Ordnergenerator, Fälle und Fallarchiv

Arbeitsstand vom 9. September 2026 auf Basis von `e7cf3f742c74bfb7d7c43368bf21a9872c1e2040`. Für die gemeinsame Beta-Veröffentlichung am 9. September 2026 freigegeben.

[Ansichten der laufenden Anwendung](mobile-fallorganisation-v1/index.html)

## Freischaltung und Bedienung

Die drei Bereiche sind eigenständige Einträge im mobilen Mehr-Menü. Sie lassen sich sortieren und als Favoriten anheften. Vorhandene Menüfolge, Favoriten und Start-/Chats-Positionen bleiben erhalten. Das Menü enthält damit 35 sichtbare Bereiche; „Fallarchiv“ ist von „Archivierte Formulare“ getrennt.

Alle drei Bereiche nutzen die gemeinsame mobile Kopfzeile, Listen- und Detailansicht, Formulare, Filter- und Aktionsblätter sowie die dynamische Navigation. Das Plus dient dem Anlegen. Formulare behalten erreichbare Abschlussaktionen und warnen beim Verwerfen ungespeicherter Eingaben. Lange Inhalte scrollen innerhalb der Ansicht; die gemeinsame Höhenberechnung nutzt frei werdenden Platz, wenn die Navigation oder die Bildschirmtastatur ihren Zustand ändert.

| Bereich | Mobile Abläufe und erhaltene Funktionen |
| --- | --- |
| Ordnergenerator | Standardstruktur und aus Falldaten erzeugte Unterordner; Suche nach Name oder Pfad; Herkunftsfilter; Navigation nach Ordnerebenen oder durch alle Ordner; Details, Anlegen, Umbenennen, Unterordner, Verschieben mit Zielauswahl sowie innerhalb einer Ebene; Einzel- und Sammellöschen; Systemvorschlag zurücksetzen; KI-Vorschläge anfordern, prüfen, einzeln übernehmen/verwerfen oder insgesamt übernehmen; ZIP-Export und Übernahme in den Datei-Explorer mit bestehender Bestandsabfrage. |
| Fälle | Suche; Status- und Inhaltsfilter; Sortierung; Details mit Aktenzeichen, Inhaltsständen, Bearbeitungsangaben und Zuordnungen; Fall öffnen/schließen; Anlegen und Bearbeiten einschließlich Betreuungsbeginn und Fristoption; rechtlichen Betreuer und Vertretung zuweisen; Einzel-/Mehrfall-/Gesamtimport, jeweils über Ordner oder ZIP; aktiven Fall sichern; Gesamtexport; Archivieren und Löschen einzeln oder gesammelt. |
| Fallarchiv | Eigene Liste und Details; Suche, Archivierungsjahr, Inhaltsfilter, Sortierung; Zurückholen und Löschen einzeln oder gesammelt. Zum Öffnen muss ein Fall weiterhin zuerst zurückgeholt werden. |

Verwaltungsfunktionen richten sich nach dem bestehenden Verwaltungsrecht; Löschen bleibt Administratoren vorbehalten. Zuordnungen werden wie bisher sofort gespeichert, mit Rücknahme der Anzeige bei Fehlern. Archivierte Fälle behalten sämtliche Daten. Die vorhandenen Speicher-, Import-, Archiv- und Exportfunktionen werden weiterverwendet. Im eingebetteten Intake bleibt der bisherige Ordnergenerator bestehen; am Desktop werden weiterhin die bisherigen Oberflächen verwendet.

## Korrigierte Begleitfehler

- Die Fristoption wurde bei der Fallanlage aus einer nicht definierten Variablen gelesen. Sie wird jetzt im richtigen Formularablauf ausgelesen.
- Das Leeren des Betreuungsbeginndatums wird gespeichert.
- Wenn das Speichern der Fallbezeichnung gelingt, der Stammdaten-PATCH jedoch scheitert, bleibt der Korrekturentwurf mit einer zutreffenden Fehlermeldung offen. Bei der Fallanlage wird ein solcher Teilerfolg ausdrücklich gemeldet, damit keine doppelte Anlage provoziert wird.
- Fehler beim Laden der mobilen Fallliste bieten einen erneuten Versuch und verdrängen den bekannten Listenstand nicht durch eine scheinbar leere Liste.
- Die Dateiauswahl für Fallimporte öffnet direkt ZIP-Dateien oder Ordner statt des allgemeinen Kamera-/Anlagendialogs.
- Eine verspätete KI-Antwort im Ordnergenerator öffnet kein bereits verlassenes Menü erneut und wird nicht in einen anderen Fall übernommen.
- Zwei vorhandene Syntaxprüfungen erwarteten noch die Scriptzahlen vor dem bereits veröffentlichten Dokumenteneditor. Die Erwartungen entsprechen jetzt dem tatsächlichen Ausgangsstand: 313 Script-/Datenblöcke, davon 231 ausführbare JavaScript-Blöcke.

## Prüfung

- 238 Browserprüfungen erfolgreich: 65 Modulprüfungen in Chromium, 68 in WebKit einschließlich Importformular, 105 bestehende Menüprüfungen in WebKit.
- Browserprüfung mit echter ausgelieferter HTML-Datei, synthetischen Fällen und abgefangenen API-Aufrufen in Chromium und WebKit.
- Rechte, Suche und Filter, Detailrückwege, Zuordnungen, Speicherfehler, Entwurfsschutz, Fallanlage samt Fristoption, Archivierung und Rückholung, Sammelaktionen mit Teilfehlern, Ordneroperationen, KI-Übernahme, ZIP-Export und Explorer-Übernahme.
- 320, 390 und 570 Pixel Breite, hell und dunkel; Desktopdarstellung; Chat-Rückkehr und simulierte Bildschirmtastatur.
- Bestehende Navigationsprüfung mit neuen und gespeicherten Profilen, Favoriten, Sortierung, Start-/Chats-Zugang und Mitarbeiterchat-Badge.
- 20 automatisierte Tests für Navigation, Fall-ID-Zuordnung, Online-Fallladen und lokale Fallgrundlagen erfolgreich. Alle 231 ausführbaren Scriptblöcke syntaktisch geprüft.
- 310 nicht bearbeitete Script-/Datenblöcke sind bytegleich zum Ausgangsstand. Die eingebetteten Vorlagen und Bibliotheken sowie das vorhandene NUL-Zeichen bleiben erhalten. Der erzeugte Ordner-ZIP wurde zusätzlich auf lesbare Pfade und CRC-Integrität geprüft.

Die Browseraufnahmen verwenden ausschließlich Testdaten. Ein physisches iPhone und ein echter Datenbank- oder KI-Server wurden in dieser Prüfung nicht eingesetzt.

Prüfprogramm: `server/scripts/qa-mobile-case-organization.cjs`. Start mit `PLAYWRIGHT_MODULE` auf die installierte Playwright-Bibliothek; `MOBILE_QA_BROWSER=webkit` wählt WebKit, `MOBILE_QA_OUTPUT` das Ausgabeverzeichnis. Protokolle und Screenshots stehen neben der Ansichtengalerie.
