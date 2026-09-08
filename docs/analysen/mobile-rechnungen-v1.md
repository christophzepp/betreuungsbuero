# Mobile Umstellung: Ausgangsrechnungen

Stand: 07.09.2026. Die Rechnungsverwaltung folgt auf Banking. Grundlage ist der vorhandene Arbeitsstand auf Release v0.7.7 (`9b28c434343743b116da66f37cb88d0b7cbc2019`), Branch `codex/mobile-foundation-chats`. Die Umsetzung liegt lokal und ist unveröffentlicht.

[Galerie mit zwölf tatsächlichen App-Ansichten](mobile-rechnungen-v1/ansichten.html)

## Umfang und Gestaltung

Die Smartphone-Oberfläche verwendet die gemeinsame dunkelblaue Kopfzeile, flache Rechnungszeilen, eigene Detail- und Formularseiten, Filterblätter sowie fest erreichbare Aktionen. Der gemeinsame Zugang zu Chats einschließlich Mitarbeiterchat-Badge und die vereinbarten Navigationsregeln bleiben erhalten.

| Bereich | Mobile Bedienung |
| --- | --- |
| Rechnungsliste | Offen, Bezahlt und Alle; Nummer, Empfänger, Summe, Zweck/Fall, Fälligkeit, Restbetrag und berechneter Status. Bewilligungen bleiben auch bei überfälligen Rechnungen erkennbar. Nachladen in Schritten von 60 ohne Begrenzung des erreichbaren Bestands. |
| Suche und Filter | Live-Suche nach Nummer, Empfänger, Zweck, Fall, Zeitraum, Datum und Betrag; Status, Rechnungsjahr, Empfänger, Fall, Fälligkeit und Sortierung. Filter lassen sich kombinieren und zurücksetzen. Eine konkrete Statusauswahl wechselt zum Gesamtbestand, damit sie nicht durch den bisherigen Reiter ausgeschlossen wird. |
| Kennzahlen | Offener Betrag und davon überfälliger Betrag beziehen sich auf die gefilterte Liste. Teilzahlungen reduzieren den offenen Betrag. |
| Details | Vollständiger Zweck, Rechnungsnummer/-datum, Fall, Zeitraum, Zahlungsziel, Summe, Eingangsbetrag/-datum, Restbetrag, Differenz und Bewilligung. Vorherige/nächste Rechnung folgen der gefilterten Liste. |
| Neu und Bearbeiten | Alle elf vorhandenen Felder: RE-Datum, RE-Nummer, Empfänger, Verwendungszweck, Fall, Zeitraum, Summe, Zahlungsziel, Status, Eingangsdatum und Eingangsbetrag. Einspaltige Abschnitte und feste Aktionen für Speichern/Abbrechen; vorgeschlagene nächste Rechnungsnummer. |
| Bewilligung und Zahlung | Bewilligung mit Datum; vollständigen Eingang bewusst bestätigen oder Teilzahlung/Korrektur im vorhandenen Formular bearbeiten. Zahlungseingänge und Status verwenden die bisherigen fachlichen Regeln. |
| Löschen | Bestehende Bestätigung und DELETE-Route; abgebrochene Bestätigung verändert nichts. |
| Vergütungsvorschau | Eigene Ansicht mit offenen Vergütungsfristen und Kennzahlen nach Status. Alle geladenen Fristen sind erreichbar, einschließlich der bisher hinter dem 40er-Darstellungslimit verborgenen. Fallkennung hat Vorrang; Namensvergleich bleibt Rückfallebene für Rechnungen ohne Kennung. |
| Zahlungsabgleich | Eigene Ansicht mit allen gelieferten Vorschlägen aus den Büro-Kontoauszügen, einschließlich der bisher hinter dem 25er-Darstellungslimit verborgenen. Prüfung mit Zahler, vollständigem Buchungstext, Datum, Rechnungssumme, bisherigem Eingang, neuem Gesamteingang und Restbetrag; fest erreichbare Bestätigung. |
| Exporte | Bestehende Excel- und PDF-Listenexporte übernehmen Suche und Filter. Einzelne Datensätze sind zusätzlich als PDF-Übersicht exportierbar. Im bisherigen PDF-Generator wurde die falsch platzierte Gesamtsumme der Zahlungseingänge in die Spalte „Eingangsbetrag“ korrigiert. |

Der Bereich verwaltet **Ausgangsrechnungen und Vergütung**, der Banking-Anschluss gleicht **eingehende Zahlungen** ab. Die Datenfelder und Serververträge bleiben erhalten. Das Mockup wurde daran angepasst: Positionen mit Menge/Einzelpreis, eigenständige Rechnungsanlagen und Mahnungen existieren in diesem Modul bisher nicht. Sie wurden nicht als funktionslose Bedienelemente ergänzt. Der PDF-Export ist eine Datensatz-/Listenübersicht; er erzeugt kein vollständiges Rechnungsdokument mit Positionen. Vorhandene Herkunftsverknüpfungen (`reportId`) bleiben beim Bearbeiten erhalten.

Der Server unterstützt keine Neuanlage im Status „Entwurf“. Der Altbestand mit diesem Status bleibt sichtbar und beim Bearbeiten erhalten. Neue Datensätze verwenden die vorhandenen zulässigen Statuswerte. „Rechnung vorhanden“ in der Vergütungsvorschau bedeutet weiterhin, dass für den Fall eine Rechnung existiert; der Abrechnungszeitraum muss geprüft werden.

## Eingabeschutz und Fehlerfälle

- Zurück, Abbrechen, Navigation und Schließen schützen ungespeicherte Eingaben. Beim Chat-Ausflug sowie beim Wechsel zwischen Desktop- und Smartphonebreite bleiben die tatsächlichen Formularfelder erhalten. Auch zuvor am Desktop geänderte Datumsfelder und ihr Verwerfschutz bleiben bestehen.
- Speichern sperrt Eingaben und Aktionen. Weitere Berührungen starten keinen zweiten Schreibvorgang. Fehler bleiben im Formular sichtbar und erhalten alle Werte.
- Eine bestätigte Neuanlage wird bei anschließendem Ladefehler nicht erneut zum Speichern angeboten. Der bestätigte Datensatz bleibt sichtbar; der Lesezugriff kann wiederholt werden.
- Verspätete Antworten ersetzen weder einen neueren Bestand noch ein inzwischen geöffnetes anderes Modul. Büroereignisse werden während eines offenen Entwurfs zur späteren Aktualisierung vorgemerkt.
- Archivierte/verwaiste Fallzuordnungen werden nicht versehentlich gelöscht. Bewilligungsdatum und Herkunft bleiben erhalten. Eine fehlerhaft geladene Fallliste wird im Formular ausdrücklich angezeigt.
- Die nächste Rechnungsnummer überschreibt weder eine manuelle Eingabe noch ein inzwischen geöffnetes anderes Formular.
- Teilzahlungen werden zum vorhandenen Eingang addiert und erhalten dessen erstes Datum. Eine erfolgreich übernommene Kontobuchung wird in derselben Sitzung nicht erneut zur Zuordnung angeboten.
- Die zusätzliche Buchungskennung wird **nicht dauerhaft gespeichert**, weil der bestehende Server dafür kein Feld vorsieht. Der neue Schutz gilt innerhalb der laufenden Sitzung; nach einem Neuladen sowie bei paralleler Bearbeitung durch andere Mitarbeiter bleibt eine erneute fachliche Prüfung notwendig. Eine dauerhafte transaktionsbezogene Zuordnung wäre eine eigene Erweiterung des Rechnungsmodells.
- Fehlgeschlagene Rechnungs-, Fristen- und Vorschlagsabfragen werden als Fehler mit erneutem Versuch ausgewiesen. Leserechte zeigen keine Bearbeitungs-/Zahlungsaktionen. Für den Zahlungsabgleich bleibt zusätzlich das Recht für Büro-Finanzen erforderlich.
- Abwärtsscrollen blendet die Navigation aus; Aufwärtsscrollen, Anfang und neue Ansichten zeigen sie. Die Tastatur blendet sie aus, während die Formularaktionen oberhalb der Tastatur erreichbar bleiben.

## Prüfung

| Prüfung | Ergebnis |
| --- | --- |
| Rechnungen im Browser | 59 erfolgreiche Prüfschritte, einschließlich Abschluss ohne JavaScript-Laufzeitfehler |
| Gezielte mobile, Kalender-, Mail-, Rechnungs- und Vergütungstests | 170 erfolgreich, darunter zwölf neue Verhaltenstests für mobile Rechnungen |
| Dokumentation und Chats | 28 erfolgreiche Prüfschritte einschließlich Abschlussmeldung |
| Gemeinsame Navigation | 23 erfolgreiche Browserprüfungen |
| Gesamtsuite | 1.267 Tests: 1.263 erfolgreich, drei bekannte Fehler, einer übersprungen |
| Skripte und eingebettete Daten | 229 ausführbare Blöcke syntaktisch gültig; 311 Scriptblöcke insgesamt; alle 82 eingebetteten Datenblöcke und das vorhandene NUL-Byte unverändert |

Die drei Fehler der Gesamtsuite betreffen die schon am unveränderten Release nachgewiesene Backup-/Recovery-Registrierung von `office_ai_config.allowed_models` und den V230-PDF-Golden-Vergleich. [Baseline-Nachweis](mobile-fundament-v1/baseline-fehler.txt). Nach der letzten Anpassung der festen Zahlungsbestätigung wurden der Rechnungs-Browserlauf und die 170 gezielten Tests erneut erfolgreich ausgeführt.

Die Browserprüfung verwendet die echte ausgelieferte HTML-App an einer vollständig abgefangenen HTTP-Testadresse. Fälle, Rechnungen und Kontobuchungen sind synthetisch. Geprüft sind unter anderem Neuanlage und Bearbeitung, vollständige Felder, Altbestand, Bewilligung, Zahlung, bestätigtes/abgebrochenes Löschen, echte PDF-/Excel-Dateien, Fehler und verzögerte Antworten, Doppelberührungen, Chat-Rückkehr, Desktopwechsel, lokale Speicherung und Rechte. Die Listen passen bei 320, 360, 390 und 430 px in Hell und Dunkel ohne horizontalen Überlauf.

Physische Smartphones und produktive Mehrbenutzersitzungen wurden nicht geprüft. Die Tastaturprüfung simuliert den VisualViewport. Datumsfelder werden vom jeweiligen Browser lokalisiert. Es erfolgten keine produktiven Rechnungsänderungen oder Bankbuchungen.

## Nachweise

[Browserprüfung](mobile-rechnungen-v1/browser-pruefung.txt) · [Gezielte Tests](mobile-rechnungen-v1/gezielte-tests.txt) · [Gesamtsuite](mobile-rechnungen-v1/vollstaendige-testsuite.txt) · [Syntax](mobile-rechnungen-v1/syntax-pruefung.txt) · [Integrität](mobile-rechnungen-v1/integritaet.txt) · [Dokumentation/Chats](mobile-rechnungen-v1/fundament-regression.txt) · [Navigation](mobile-rechnungen-v1/navigation-regression.txt).

Browserlauf: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright node server/scripts/qa-mobile-invoices.cjs`.

Verhaltenstests: `node --test server/tests/html-mobile-invoices.test.cjs`.

Als nächste eigenständige Umbauetappe folgt die Rechnungslegung.
