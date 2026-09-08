# Mobile Umstellung: E-Mail

Die E-Mail-Ansicht ist als eigener Umbau nach dem Kalender umgesetzt. Stand: 07.09.2026, Release v0.7.7 (`9b28c434343743b116da66f37cb88d0b7cbc2019`) mit dem vorhandenen mobilen Fundament und den bereits umgebauten Modulen. Die Änderungen liegen lokal auf `codex/mobile-foundation-chats` und sind nicht veröffentlicht.

[Galerie der umgesetzten Ansichten](mobile-email-v1/ansichten.html)

## Bedienung und Funktionsumfang

Die neue Oberfläche verwendet die gemeinsame dunkle Kopfzeile, flache Nachrichtenlisten, eine eigene Nachrichtenseite, ein gegliedertes Formular, Filterblätter und fest erreichbare Formularaktionen. Die ursprünglichen Eingabeelemente und ihre Funktionen werden in den mobilen Rahmen übernommen. Es gibt keinen zweiten Nachrichteneditor und keine neue Postfach-Datenbank.

| Bereich | Mobiler Zugang und erhaltener Funktionsumfang |
| --- | --- |
| Nachrichtenliste | Eingang, Entwürfe und Gesendet; Postfachkennzeichnung, Betreff, Absender, Datum, Anlagen, Priorität, Stern, Lesestatus, vorhandene Vorschau und Fallhinweise |
| Postfächer und Ordner | Gesamt-Posteingang, sämtliche Konten und Ordner einschließlich Postausgang, Archiv, Spam und Papierkorb; aufklappbare Ordnerstruktur, neue Ordner, Umbenennen und Löschen über die vorhandenen Funktionen |
| Anordnung | Zusätzlich zur bestehenden Mausbedienung ein Touch-Formular für Kontoreihenfolge, Ordnerreihenfolge und Verschieben von Ordnern in andere Ordner |
| Suche | Vorhandene Serversuche über Betreff, Absender und Text; Suchbereich aktueller Ordner, Konto oder alle Konten |
| Filter | Postfach, gelesen/ungelesen, mit/ohne Anlagen, Stern, Fall einschließlich ohne Zuordnung, Priorität, Label, Absender und Betreff; Sortierung und Gruppierung von Unterhaltungen; explizit Anwenden und Zurücksetzen |
| Nachladen | Bestehende seitenweise Abfrage; auch bei zunächst leerem Filterergebnis bleiben weitere Nachrichten erreichbar. Anzeige unterscheidet sichtbare, geladene und insgesamt gemeldete Nachrichten |
| Sammelauswahl | Auswählen, alle auswählen/abwählen, gelesen/ungelesen, Verschieben, Spam beziehungsweise kein Spam, Archivieren und Löschen |
| Nachricht lesen | Absender und Empfänger einschließlich Cc/Bcc, Datum, HTML beziehungsweise Text, Anlagen-Downloads und Fallablage; HTML bleibt im bestehenden abgeschotteten Iframe, externe Bilder werden weiterhin zunächst blockiert |
| Nachrichtenaktionen | Antworten und Weiterleiten unten; weitere Aktionen im Blatt: Allen antworten, Archivieren, Verschieben, Papierkorb, Spam, Stern, Lesestatus, Labels, Wiedervorlage und sämtliche vorhandenen weiteren Werkzeuge |
| Weitere Werkzeuge | Vorhandene Untermenüs etwa für EML, Drucken, Aufgaben-/Terminanlage, weitere Modul-Schnellanlagen, KI-Antwort sowie externe Lese- und Bearbeitungsfenster bleiben über ihre ursprünglichen Aktionen erreichbar |
| Verfassen | Absenderkonto, An/Cc/Bcc, Kontaktvorschläge und Kontaktauswahl, Betreff, Fallbezug mit Platzhaltern, Rich-Text-Nachricht, Signatur, Vorlagen und Anlagen; Formatierung ist aufklappbar |
| Anlagen | Dateien vom Gerät und aus dem Datei-Explorer, Entfernen, vorhandene Größenbegrenzung; Weiterleitungsanlagen werden über dieselbe Nachrichtenschnittstelle geladen |
| Versand | Senden, Entwurf sichern, Speichern beim Zurückgehen, Minimieren und Wiederherstellen weiterer Entwürfe, Verwerfen, Auslagern in ein Fenster; Priorität, Versandwarnungen, Sendeverzögerung mit Rückgängig und geplanter Versand bleiben erhalten |
| Falldokumentation und KI | Bestehende Fallzuordnung, Ablage und Dokumentationsoption beim Versand sowie ursprüngliche KI-Werkzeuge im Lese- und Schreibbereich |
| Kontenverwaltung | Kontenliste und Formular im mobilen Rahmen; bestehende IMAP/SMTP- und Microsoft-365-Felder, Verbindungstest, Speichern, Löschen, Standardkonto, Systemversand, Sichtbarkeit, Signatur- und Speicheroptionen sowie angebotene Abwesenheitsfunktionen |

Konten, Berechtigungen, Anbietervorgaben und die verfügbaren Serverfunktionen bestimmen weiterhin, welche Aktionen angeboten werden. Die kurzen Register „Entwürfe“ und „Gesendet“ beziehen sich auf das aktuelle beziehungsweise voreingestellte Konto; alle anderen Postfächer bleiben über das Ordnerblatt erreichbar. Einstellungen außerhalb der E-Mail-Ansicht verwenden weiterhin ihre bestehenden Zugänge.

Die Anzeigefilter arbeiten auf den **bereits geladenen Nachrichten**. Die Serversuche behält ihre vorhandenen Grenzen; die Suche über mehrere Ordner berücksichtigt beispielsweise höchstens 40 Ordner. Der Umbau führt keine vollständige serverseitige Filterung des gesamten Mailbestands ein.

## Eingaben, Navigation und Fehlerfälle

- Die Navigation folgt dem vereinbarten Standard: beim Abwärtsscrollen ausblenden, beim Aufwärtsscrollen, oben und beim Ansichtswechsel anzeigen; bei geöffneter Tastatur ausblenden. Senden und Entwurf sichern bleiben im Formular erreichbar.
- Chats mit Mitarbeiterchat-Badge bleiben im gemeinsamen Zugang. Eine Chat-Rückkehr stellt die tatsächlichen Formularfelder einschließlich Anlagen wieder her. Die Chat-Ebene lässt den Zugang für die Rückkehr frei.
- Cc/Bcc, Absender- und Fallwechsel erhalten die bestehenden Eingaben. Das erneute Committen eines Empfängers durch ein während des Chip-Aufbaus ausgelöstes Blur-Ereignis wurde behoben.
- Ein aktiver Entwurf wird durch erneutes Öffnen des Mailmoduls nicht ersetzt. Während Speichern, Senden oder Einlesen von Anlagen sind konkurrierende Formularaktionen und der Chatwechsel gesperrt.
- Fehlgeschlagenes Entwurfspeichern lässt den Editor offen. Auch Zurück und Minimieren warten auf eine bestätigte Speicherung. Kontoeingaben haben den gemeinsamen Schutz vor versehentlichem Verwerfen.
- Fallkontext, geplanter Zeitpunkt und noch ausstehende Weiterleitungsanlagen werden in den vorhandenen JSON-Entwurfsdaten mitgesichert. Konto- und Fallfilter berücksichtigen auch Entwürfe.
- Bei Fehlern des unmittelbaren Versands wird die vorhandene Sicherung im Postausgang versucht; der Editor bleibt mit den Eingaben offen, auch wenn diese zusätzliche Sicherung scheitert.
- Fehlende Weiterleitungsanlagen werden benannt. Senden bleibt gesperrt, bis sie erneut geladen oder ausdrücklich weggelassen wurden. Ein erneuter Ladeversuch hängt erfolgreich geladene Dateien nicht doppelt an.
- Ein geplanter Versand wird erst nach bestätigter Aufhebung des Zeitplans zur Bearbeitung geöffnet.
- Ladefehler werden mit erneutem Ladezugang angezeigt. Bei vollständig fehlgeschlagenem Abruf im selben Listenbereich werden vorhandene Nachrichten wieder angezeigt; bereits geladene Entwürfe bleiben bei Abruffehlern erhalten. Verspätete Such- und Leseantworten dürfen neuere Auswahlen nicht ersetzen.

Die Desktopoberfläche bleibt bei ihren bisherigen Postfachspalten und Fenstern. Die gemeinsamen Anpassungen beschränken sich auf die Erkennung der sichtbaren mobilen Ansicht und die Größe beziehungsweise Rückkehr der Chat-Ebene.

## Prüfstand

| Prüfung | Ergebnis |
| --- | --- |
| E-Mail im Browser | 52 Prüfungen erfolgreich |
| Gezielte mobile, Kalender- und Mailtests | 119 Tests erfolgreich; darunter fünf neue Verhaltenstests für Filter und Empfängerübernahme |
| Kalender-Regression | 46 Browserprüfungen erfolgreich |
| Aufgaben-Regression | 42 Browserprüfungen erfolgreich |
| Fristen, Wiedervorlagen, Adressbuch und Stammdaten | 61 Browserprüfungen erfolgreich |
| Navigation | 23 Browserprüfungen erfolgreich |
| Dokumentation und Chats | 28 erfolgreiche Prüfschritte einschließlich Abschlussmeldung |
| JavaScript | 229 ausführbare Blöcke syntaktisch gültig; weiterhin 311 Script-Blöcke insgesamt |
| Vollständige Suite | 1.241 Tests: 1.237 erfolgreich, drei fehlgeschlagen, einer übersprungen |

Die drei Fehler entsprechen den bereits am unveränderten Release nachgewiesenen Fehlern: Backup-Registrierung und Recovery-Bootstrap für `office_ai_config.allowed_models` sowie V230-PDF-Golden-Rendering. [Vorhandener Baseline-Nachweis](mobile-fundament-v1/baseline-fehler.txt).

Die Browserprüfungen laufen gegen die echte ausgelieferte HTML-App mit synthetischen Nachrichten und abgefangenen Serverzugriffen. Geprüft wurden unter anderem Lesen, Antworten, Cc/Bcc, Kontowechsel, Fallbezug, Geräte- und Datei-Explorer-Anlagen, Entwürfe, Speicher- und Versandfehler, Weiterleitungsanlagen, Versandplanung, Rückgängig, Nachladen, verspätete Antworten, Chat-Rückkehr und Kontobearbeitung. Die Oberflächen wurden bei 320–430 px, in Hell und Dunkel sowie mit simuliertem Tastatur-Viewport geprüft.

Es wurden keine echten E-Mails versendet oder Produktionsdaten verändert. Tests auf physischen iOS-/Android-Geräten, mit echten Mailanbietern, Microsoft-Anmeldung, Druck-/Popup-Verhalten und produktiven Mehrbenutzerrechten stehen noch aus. Die Tests prüfen nicht jede Kombination aller bestehenden serverseitigen Mailfunktionen.

## Nachweise

[E-Mail-Browserprüfung](mobile-email-v1/browser-pruefung.txt) · [Gezielte Tests](mobile-email-v1/gezielte-tests.txt) · [Gesamtsuite](mobile-email-v1/vollstaendige-testsuite.txt) · [Syntax](mobile-email-v1/syntax-pruefung.txt)

[Kalender](mobile-email-v1/kalender-regression.txt) · [Aufgaben](mobile-email-v1/aufgaben-regression.txt) · [Modulpaket](mobile-email-v1/modulpaket-regression.txt) · [Navigation](mobile-email-v1/navigation-regression.txt) · [Dokumentation und Chats](mobile-email-v1/fundament-regression.txt)

Reproduktion: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright node server/scripts/qa-mobile-mail.cjs`. Neue Verhaltenstests: `node --test server/tests/html-mobile-mail.test.cjs`.

Der Datei-Explorer als vollständiges Modul, Banking, Rechnungen und weitere Finanzmodule bleiben die anschließenden eigenen Umbauetappen. In dieser Etappe wurde beim Datei-Explorer ausschließlich der für E-Mail-Anlagen benötigte Auswahldialog angepasst.
