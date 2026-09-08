# Mobile Umstellung: Banking

Stand: 07.09.2026. Banking folgt als eigenständiger Bereich auf den Datei-Explorer. Grundlage ist der vorhandene Arbeitsstand auf Release v0.7.7 (`9b28c434343743b116da66f37cb88d0b7cbc2019`). Die Änderungen liegen lokal auf `codex/mobile-foundation-chats` und sind unveröffentlicht.

[Galerie mit 19 tatsächlichen App-Ansichten](mobile-banking-v1/ansichten.html)

## Aufbau und Funktionsumfang

Die Smartphone-Oberfläche verwendet die gemeinsame dunkelblaue Kopfzeile, flache Listen, eigene Detail- und Formularseiten, Filterblätter und fest erreichbare Aktionen. Die drei Reiter heißen **Umsätze**, **Aufträge** und **Regelmäßig**. Die Kontenkarte zeigt den tatsächlichen Kontostand mit Datum; fehlende Salden bleiben als fehlend gekennzeichnet.

| Bereich | Mobile Bedienung und vorhandene Funktionen |
| --- | --- |
| Konten und Fälle | Geöffneter Fall, andere sichtbare Fälle, alle sichtbaren Fälle sowie eigener Zugang für Bürokonten; einzelne oder alle Konten; Konto, IBAN, Saldo und Stand. Die Kontoauswahl im Filterblatt folgt unmittelbar dem gewählten Fall und wird beim Zurücksetzen ebenfalls zurückgesetzt. |
| Umsätze | Suche nach Gegenüber, Zweck, Fall und Kontoname; Konto, sieben Zeiträume und Richtung als kombinierbare Filter; Buchungstag, Betrag und Zweck in der Liste. Weitere Zeilen werden in Schritten von 80 eingeblendet und bleiben auch oberhalb des früheren 400-Zeilen-Limits erreichbar. |
| Umsatzdetails | Vollständiger Verwendungszweck, eigenes Konto und IBAN, Gegenkonto, Buchungs- und Wertstellungstag, Währung, Fall und vorhandener Saldo nach Buchung; Übernahme in die Handkasse des zugehörigen Falls. |
| Aufträge | Suche und Statusfilter für Entwurf, Freigabe, Einreichung, Ausführung, Fehler und Stornierung; Termin, Empfänger, Zweck, Betrag und Status. Keine stille Begrenzung auf die früheren 120 Aufträge. |
| Auftragsdetails | Empfänger, beide IBANs, BIC, Betrag, Zweck und Fall; Status einschließlich Fehlerdetails, Termine, Ersteller und Freigebender, Herkunft, Zahlungsreferenz, Hibiscus-ID und zugeordneter Umsatz, sofern vorhanden. |
| Zahlungsaktionen | Entwurf freigeben, freigegebenen Auftrag mit bestehender Bestätigung einreichen, stornieren, zulässige Aufträge mit bestehender Bestätigung löschen; echter EPC/Giro-QR-Code als Auswahlblatt. Die angebotenen Aktionen folgen Status und Zahlungsrecht. |
| Sammeleinreichung | Prüfansicht mit Empfänger, Betrag, Quellkonto, Ziel-IBAN und Zweck je sichtbarem freigegebenem Auftrag; anschließend bestehende Bestätigung und ursprüngliche Sammelroute. Ausgefilterte Aufträge werden nicht mitgesendet. |
| Überweisung vorbereiten | Sämtliche ursprünglichen Felder: Quellkonto, Empfängername, Empfänger-IBAN, BIC, Betrag, Ausführungsdatum und Verwendungszweck; Adressbuchübernahme einschließlich Bankverbindung; Speichern als Entwurf. Der voreingestellte Tag verwendet das lokale Datum. |
| Regelmäßige Zahlungen | Suche und Filter für aktive oder pausierte Intervallzahlungen; Rhythmus, nächste Fälligkeit, Betrag und Zustand. Details mit Beginn, Ende, Ausführungstag und vorhandener Notiz; Aktivieren, Pausieren, Löschen und Erzeugen fälliger Entwürfe. |
| Intervallformular | Quellkonto, Name, IBAN, BIC, Betrag, sämtliche vorhandenen Rhythmen, Ausführungstag, Beginn, optionales Ende und Zweck mit Monatsplatzhalter. Bei täglichen, wöchentlichen und vierzehntägigen Intervallen wird der Monatstag ausgeblendet. |
| Rechnungserkennung | Überweisung oder Intervallzahlung aus Rechnung; Kamera, Bildergalerie, Dateien und interne Ablage des angezeigten Falls. Bestehende lokale OCR und ausgewählter KI-Dienst erzeugen einen bearbeitbaren Vorschlag. Die Erkennung legt selbst keinen Zahlungsauftrag an. |
| Exporte und Auswertungen | PDF und CSV für Umsätze, Aufträge und Intervalle über die bestehenden Generatoren; die Listenexporte folgen der jeweiligen Suche und Filterung. Saldoverlauf, Einnahmen/Ausgaben je Monat und größte Empfänger bleiben erreichbar. Die Umsatz-PDF ist eine erzeugte Übersicht, kein Bank-Original. |
| Rechnungslegung | Vorhandene Übernahme für den geöffneten Fall; die Prüfansicht erklärt, dass alle geladenen Umsätze des ausgewählten Kontos und Zeitraums übernommen werden, unabhängig von Suche und Richtungsfilter. |
| Banking-Einstellungen | Ursprüngliche Verbindungseinstellungen, gespeichertes Passwort beibehalten, Zertifikatsoption, Verbindungstest, Aktualisieren von Konten und Salden, automatischer und manueller Umsatzabruf; ursprüngliche Rechte bleiben wirksam. |
| Kontozuordnung und Importe | Kontoabruf aktivieren/deaktivieren; automatische oder manuelle Fall-/Bürozuordnung. MT940-/CAMT-Dateiimport mit ursprünglichem Parser und Dublettenschutz; Vorschau und Übernahme von Büroumsätzen mit Konto, Zeitraum und Buchungsart. Kontoauszug-Dateien erhalten die passenden Quellen Dateien und Explorer. |

Die Darstellung verwendet die bestehenden Daten und Serververträge. Kontozuordnungen bleiben Fall-/Bürozuordnungen am vorhandenen Bankkonto. Rechnungsdateien werden über den vorhandenen Erkennungsweg verarbeitet. Intervallzahlungen erzeugen Entwürfe; Bank-Daueraufträge werden weiterhin in Hibiscus beziehungsweise im Onlinebanking verwaltet.

## Eingabeschutz und Fehlerbehandlung

- Die gemeinsamen Navigationsregeln gelten auch für Banking: abwärts ausblenden, aufwärts beziehungsweise am Anfang und bei einer neuen Ansicht anzeigen, bei geöffneter Tastatur ausblenden. Die jeweilige Aktionsleiste bleibt erreichbar.
- Der gemeinsame Chats-Zugang bleibt erhalten. Beim Ausflug in den KI-Chat werden die tatsächlichen Formularfelder aufbewahrt und anschließend wiederhergestellt.
- Zurück und Abbrechen berücksichtigen ungespeicherte Zahlungs- und Konfigurationseingaben. Zahlungsfelder und Verwerfschutz bleiben beim Wechsel zwischen Smartphone- und Desktopbreite erhalten.
- Während eines Zahlungs- oder Speichervorgangs werden Eingaben und Aktionen gesperrt. Ein weiterer Touch startet keinen zweiten Vorgang. Fehler bleiben am Formular sichtbar; Eingaben bleiben bestehen.
- Eine laufende Rechnungsanalyse schützt ihren Banking-Kontext. Eine Datei aus einer inzwischen verlassenen Fallansicht wird nicht in einen anderen Fall übernommen.
- Verzögerte Antworten dürfen die Daten eines inzwischen gewählten anderen Falls nicht ersetzen. Ein gescheiterter Kontoabruf wird als unvollständige Umsatzliste ausgewiesen, mit erneutem Versuch. Die vorhandene Warnung für die Servergrenze von 2.000 Umsätzen pro Konto bleibt erhalten.
- Die Büroübersicht lädt ihre Kennzahlen unabhängig vom geöffneten Banking-Fall. Sie verändert keine offenen Zahlungsformulare und keinen Fallfilter.
- Die Handkassenübernahme bezieht im Modus „Alle Fälle“ die Fall-ID aus den Kontometadaten des gewählten Umsatzes. Der vorhandene Dublettenschutz bleibt erhalten.
- Aktualisierte Kontozuordnungen und neu geladene Einstellungsdaten erhalten offene Verbindungseingaben. Die administrativen Funktionen verwenden weiterhin ihre ursprünglichen Berechtigungsprüfungen und Serverwege.

## Prüfstand

| Prüfung | Ergebnis |
| --- | --- |
| Banking im Browser | 64 Prüfungen erfolgreich, keine JavaScript-Laufzeitfehler |
| Gezielte mobile, Kalender- und Mailtests | 133 Tests erfolgreich, davon acht neue Banking-Verhaltenstests |
| E-Mail-Regression | 52 Browserprüfungen erfolgreich |
| Navigation | 23 Browserprüfungen erfolgreich |
| Dokumentation und Chats | 28 erfolgreiche Prüfschritte einschließlich Abschlussmeldung |
| Gesamtsuite | 1.255 Tests: 1.251 erfolgreich, drei bekannte Fehler, einer übersprungen |
| JavaScript und eingebettete Daten | 229 ausführbare Blöcke syntaktisch gültig; 311 Scriptblöcke insgesamt; alle 82 eingebetteten Datenblöcke sowie das vorhandene NUL-Byte unverändert |

Die drei Fehler der Gesamtsuite betreffen die bereits am unveränderten Release nachgewiesene Backup-/Recovery-Registrierung von `office_ai_config.allowed_models` sowie den V230-PDF-Golden-Vergleich. [Baseline-Nachweis](mobile-fundament-v1/baseline-fehler.txt). Nach der abschließenden kleinen Korrektur am Zurücksetzen der Kontoauswahl wurden der Banking-Browserlauf und die 133 gezielten Tests erneut erfolgreich ausgeführt.

Die Browserprüfungen verwenden die **echte ausgelieferte HTML-App**, synthetische Konten und abgefangene Serverzugriffe. Sie prüfen unter anderem Entwurf, Freigabe, bestätigte und abgebrochene Einreichung, gefilterte Sammeleinreichung, Speicherfehler und doppelte Berührungen, Intervallanlage und Statuswechsel, Adressbuchübernahme, Rechnungsvorschlag, tatsächliche PDF-/CSV-Dateien, MT940- und Büroimport-Verträge, Kontozuordnung, Chat-Rückkehr, Tastatur sowie verspätete Abrufantworten. Der Monats-/Richtungsfilter und die serverseitige Kappung bleiben in den jeweiligen Ansichten erkennbar. Eine Liste mit 405 Buchungen bestätigt die Erreichbarkeit jenseits des alten Darstellungslimits.

Die Listen wurden bei 320, 360, 390 und 430 px in Hell und Dunkel auf horizontalen Überlauf geprüft, die Einstellungen zusätzlich bei 320 px. Die Tastaturprüfung simuliert den VisualViewport. Die Büroansicht wird mit einem getrennten synthetischen Konto geprüft.

**Es erfolgten keine echten Bankzugriffe oder Zahlungen.** Physische iPhone-/Android-Geräte, reale Hibiscus-/TAN-Verfahren, echte OCR-/KI-Dienste sowie produktive Bankdateien und Mehrbenutzerkonstellationen sind noch nicht Ende zu Ende geprüft. Die vorhandenen Serverfunktionen wurden für den Umbau beibehalten; die Prüfung der mobilen Zugänge ersetzt keinen Live-Test jeder Integration.

## Nachweise und Reproduktion

[Banking-Browserprüfung](mobile-banking-v1/browser-pruefung.txt) · [Gezielte Tests](mobile-banking-v1/gezielte-tests.txt) · [Gesamtsuite](mobile-banking-v1/vollstaendige-testsuite.txt) · [Syntax](mobile-banking-v1/syntax-pruefung.txt) · [Integrität](mobile-banking-v1/integritaet.txt)

[E-Mail](mobile-banking-v1/email-regression.txt) · [Navigation](mobile-banking-v1/navigation-regression.txt) · [Dokumentation und Chats](mobile-banking-v1/fundament-regression.txt)

Browserlauf: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright node server/scripts/qa-mobile-banking.cjs`.

Verhaltenstests: `node --test server/tests/html-mobile-banking.test.cjs`.

Rechnungen und weitere Finanzmodule bleiben die folgenden eigenständigen Umbauetappen.
