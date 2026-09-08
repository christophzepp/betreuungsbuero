# Mobile Umstellung: Datei-Explorer

Stand: 07.09.2026. Der Datei-Explorer ist als nächster eigenständiger Bereich nach E-Mail auf den gemeinsamen mobilen Aufbau umgestellt. Basis ist der vorhandene Arbeitsstand auf Release v0.7.7 (`9b28c434343743b116da66f37cb88d0b7cbc2019`). Die Änderungen liegen lokal auf `codex/mobile-foundation-chats` und sind unveröffentlicht.

[Galerie der tatsächlichen App-Ansichten](mobile-datei-explorer-v1/ansichten.html)

## Aufbau und Funktionsumfang

Die mobile Ansicht verwendet die gemeinsame dunkle Kopfzeile, flache Dateizeilen, eine eigene Dateidetailseite, gegliederte Formulare, Auswahlblätter und fest erreichbare Aktionen. Datei-, Ordner- und Dokumentleser-Funktionen bleiben mit den bisherigen Serverwegen verbunden. Es wurde kein zweiter Dokumentenspeicher eingeführt.

| Bereich | Mobile Bedienung und erhaltene Funktionen |
| --- | --- |
| Dateiliste | Name, Dateityp, Datum, Größe, Seiten, OCR-Status, Markierungen und Wiedervorlagen; ein Antippen öffnet Details; Listen- und Kachelansicht; vollständige Liste auch jenseits der bisherigen Begrenzung auf zunächst 300 Dateien |
| Suche | Namensfilter, serverseitige Volltextsuche mit Fundstellen und Seitensprung, vorhandene KI-Antwort mit Quellen; Suchraum aktueller Ordner oder ganzer Bereich |
| Dateifilter | Dateityp, Zeitraum, Größe, Markierung; Sortierung nach Name, Änderungsdatum, Größe oder Seitenzahl und Richtung; Anwenden und Zurücksetzen. Diese Filter gelten für die Dateiliste; die Volltext-/KI-Suche behält ihren eigenen Suchablauf |
| Ordner und Fälle | Fallwechsel, Büroorganisation, berechtigte Verwaltungsansicht, Ordnerbaum mit Ein-/Ausklappen, Hauptordner, Pfad und Verlauf, Papierkorb, Schnellzugriff und zuletzt geöffnete Dateien |
| Ordneraktionen | Anlegen, Umbenennen und Löschen; zusätzlicher Touch-Dialog zum Verschieben mit Ausschluss des eigenen Ordners und seiner Unterordner; vorhandene Registerstruktur, Ordnergenerator-Übernahme, ZIP- und E-Akten-/Übergabeaktionen bleiben erreichbar |
| Dateidetails | Dateimetadaten, Vorschau, Markierungen, Notiz, Wiedervorlage, Versionen und Aktivitäten; Lesen und Herunterladen unten; zugelassene weitere Aktionen im Auswahlblatt |
| Dateiaktionen | Umbenennen, Kopieren und Verschieben mit den vorhandenen Konfliktentscheidungen, OCR, KI-Analyse, Markierung, Notiz, Wiedervorlage, Versionen, neue Fassung, Schnellzugriff, E-Mail, Falldoku-Verknüpfung, Posteingang und Löschen |
| Mehrfachaktionen | Auswählen und Auswahl beenden, alle Dateien auswählen, Kopieren/Ausschneiden/Einfügen, Verschieben, ZIP, Löschen und die ursprünglichen angebotenen Sammelwerkzeuge |
| Upload | Einzelne oder mehrere Dateien, Namen und Zielordner; zusätzlich Ordner samt Unterordnern über die Geräteauswahl, sofern das Betriebssystem dies unterstützt; neuer Versionsinhalt am vorhandenen Dokument; originaler Strom-Upload mit Fortschritt und Abbruch sowie bestehender Ersatzweg |
| Papierkorb | Eigene Dateidetails mit Wiederherstellen; endgültiges Löschen über das Aktionsblatt mit der bestehenden Bestätigung |
| Externe Ablagen | Vorhandene WebDAV-, OneDrive-, Google-Drive- und Lokalordner-Verbindungen über das Ordnerblatt; Navigation, Lesen, Download und der bestehende Upload zur Verbindung; Bearbeitung bleibt von den ursprünglichen Möglichkeiten der jeweiligen Quelle abhängig |
| Dokumentleser | Tatsächlicher PDF-/Bild-/Medienleser mit seinem eigenen Seitenscroller; Dokumentauswahl, Werkzeuge und Anmerkungen als Blätter; Hand, Kommentar, Markierung, Zeichnen, Formen, Signatur, Farben, Zoom und Vollbild; vorhandener Export mit Anmerkungen und KI-Assistent |
| Einstellungen | Bestehende Bereiche für Speicherort, Markierungskatalog, Automatik, Sicherung, Import/Abgleich, Verbindungen und Freigabe; tatsächliche Felder und Aktionen in einem mobilen Formularrahmen; Abschnittslinks scrollen zum zugehörigen Bereich |

Berechtigungen und Serverfunktionen bestimmen weiterhin die verfügbaren Aktionen. Reine Leser erhalten keinen Uploadzugang und deaktivierte Schreibaktionen. Für Verbindungsdateien und Papierkorbeinträge werden keine ungeeigneten Bearbeitungslinks aus der bisherigen Detailsleiste angeboten. Eine PDF-Vorschau wird auf Mobilgeräten über den vorhandenen PDF-Leser geöffnet; der kleine eingebettete Browser-PDF-Rahmen wird dadurch vermieden.

## Schutz von Eingaben und Fehlerbehandlung

- Die gemeinsame Navigation bleibt erhalten: abwärts ausblenden, aufwärts beziehungsweise am Anfang und bei einer neuen Ansicht anzeigen, bei geöffneter Tastatur ausblenden. Die jeweiligen Formularaktionen bleiben erreichbar.
- Der gemeinsame Chats-Zugang einschließlich Mitarbeiterchat-Badge bleibt nutzbar. Die Rückkehr aus dem Chat stellt die tatsächlichen Eingabefelder wieder her.
- Dateinotizen, Markierungen, Wiedervorlagen, Namen und Kommentare bleiben bei Speicherfehlern geöffnet. Während der Speicherung sind ihre Eingaben gesperrt. Zurück, Abbrechen und Escape berücksichtigen ungespeicherte Änderungen.
- Bestätigte erfolgreiche Uploads werden beim Wiederholen eines teilweise fehlgeschlagenen Uploads übersprungen. Ausstehende Dateien bleiben ausgewählt. Dateien werden an den im Formular festgehaltenen Fall und Zielordner übergeben.
- Beim Verknüpfen mit der Falldokumentation wird nach einem fehlgeschlagenen Anlagen-Upload derselbe bereits angelegte Eintrag ergänzt. Der erneute Versuch legt dafür keinen zweiten Eintrag an.
- Ein fehlgeschlagener Ordnerwechsel stellt den vorherigen Ort einschließlich Dateien, Baum, Auswahl und Verlauf wieder her. Wiederholen verwendet das tatsächlich angeforderte Ziel. Konkurrierende Ortswechsel werden während des Abrufs gesperrt.
- Verspätete Datei- und Suchantworten dürfen einen inzwischen gewählten anderen Ordner nicht ersetzen. Hintergrundaktualisierungen dürfen Formulare, Leser und den beim Chat geparkten Explorer nicht austauschen.
- Ausschneiden/Einfügen nimmt die Metadaten und den Quellordner mit; Rückgängig kann dadurch zum ursprünglichen Ordner zurückkehren. Der vorhandene Fehler beim Entfernen eines Dateifavoriten wurde korrigiert.
- Abgebrochene Touch-Gesten im Leser räumen die vorläufige Zeichnung auf und speichern keine unvollständige Anmerkung.
- Verschachtelte mobile Dialoge geben den gemeinsamen Formularschutz beim Schließen an den übergeordneten Dialog zurück. Nachgeladenen Einstellungsdaten wird keine Benutzereingabe unterstellt.

## Prüfstand

| Prüfung | Ergebnis |
| --- | --- |
| Datei-Explorer im Browser | 56 Prüfungen erfolgreich |
| Gezielte mobile, Kalender- und Mailtests | 125 Tests erfolgreich, darunter sechs neue Verhaltenstests für Ordnerwechsel und verspätete Antworten |
| E-Mail-Regression | 52 Browserprüfungen erfolgreich, einschließlich Explorer-Dateiauswahl als E-Mail-Anlage |
| Navigation | 23 Browserprüfungen erfolgreich |
| Dokumentation und Chats | 28 erfolgreiche Prüfschritte einschließlich Abschlussmeldung |
| JavaScript und eingebettete Daten | 229 ausführbare Blöcke syntaktisch gültig; 311 Script-Blöcke insgesamt; alle 82 eingebetteten Datenblöcke und das vorhandene NUL-Byte unverändert |
| Gesamtsuite | 1.247 Tests: 1.243 erfolgreich, drei bekannte Fehler, einer übersprungen |

Die drei Fehler entsprechen den bereits am unveränderten Release nachgewiesenen Fehlern: Backup-Registrierung und Recovery-Bootstrap für `office_ai_config.allowed_models` sowie V230-PDF-Golden-Rendering. [Baseline-Nachweis](mobile-fundament-v1/baseline-fehler.txt).

Die Browserprüfung verwendet die **echte ausgelieferte HTML-App**, synthetische Dokumente und abgefangene Serverzugriffe. Ein synthetisches PDF wird mit dem tatsächlichen PDF-Baustein gerendert und als echte PDF-Datei heruntergeladen. Der originale Strom-Upload wird mit abgefangenem XHR geprüft, einschließlich Fortschritt, Abbruch und erneutem Versuch; zusätzlich wird der vorhandene Base64-Ersatzweg geprüft. Die Prüfung umfasst unter anderem Dateinotizen, Kommentarfehler, Chat-Rückkehr, Filter, Volltext, Verschieben und Rückgängig, Wiedervorlage, neue Version, Papierkorb, Ordnerhierarchie, externe Dateiliste, Rechte, Einstellungen, E-Mail-Übergabe, Navigation und Tastatur.

Die Dateiliste wurde bei 320, 360, 390 und 430 px in Hell und Dunkel auf horizontales Überlaufen geprüft. Die mobile Tastatur wird über einen simulierten VisualViewport geprüft; der Wechsel zur Desktopansicht stellt die ursprüngliche Exploreroberfläche wieder her.

Es wurden keine Produktionsdateien verändert oder E-Mails versendet. Tests auf physischen iPhones/Android-Geräten sowie mit echten Cloud-Anmeldungen, WebDAV-Speichern, Sicherungszielen, OCR-/KI-Anbietern und produktiven Mehrbenutzerrechten stehen noch aus. Die Prüfung sämtlicher Zugänge ersetzt keinen End-to-End-Test jeder Kombination der bestehenden Serverfunktionen.

## Nachweise

[Explorer-Browserprüfung](mobile-datei-explorer-v1/browser-pruefung.txt) · [Gezielte Tests](mobile-datei-explorer-v1/gezielte-tests.txt) · [Gesamtsuite](mobile-datei-explorer-v1/vollstaendige-testsuite.txt) · [Syntax](mobile-datei-explorer-v1/syntax-pruefung.txt) · [Integrität](mobile-datei-explorer-v1/integritaet.txt)

[E-Mail](mobile-datei-explorer-v1/email-regression.txt) · [Navigation](mobile-datei-explorer-v1/navigation-regression.txt) · [Dokumentation und Chats](mobile-datei-explorer-v1/fundament-regression.txt)

Reproduktion: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright node server/scripts/qa-mobile-explorer.cjs`. Neue Verhaltenstests: `node --test server/tests/html-mobile-explorer.test.cjs`.

Banking, Rechnungen und weitere Finanzmodule bleiben die anschließenden eigenen Umbauetappen.
