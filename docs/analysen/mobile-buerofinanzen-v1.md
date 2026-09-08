# Mobile Bürofinanzen

Stand: 07.09.2026. Umsetzung auf dem vorhandenen mobilen Arbeitsstand, Release-Basis v0.7.7 (`9b28c434343743b116da66f37cb88d0b7cbc2019`). Die Änderungen liegen lokal in `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html`.

[Galerie mit 32 tatsächlichen App-Ansichten](mobile-buerofinanzen-v1/ansichten.html)

## Gestaltung und Bedienung

Büroplanung und Buchhaltung verwenden die gemeinsame marineblaue Kopfzeile, drei Bereichsschalter, flache Listen, separate Details und Formulare, ein Filterblatt und fest erreichbare Aktionen. Die Büroübersicht und das Controlling erhalten ebenfalls die gemeinsame mobile Hülle. Ihre ursprünglichen Berechnungen bleiben erhalten; breite Auswertungstabellen werden auf dem Smartphone als beschriftete Datensätze dargestellt.

Der bestehende Chats-Zugang bleibt erreichbar. Die Navigation folgt dem vereinbarten Standard: beim Herunterscrollen ausblenden, beim Hochscrollen beziehungsweise am Anfang und beim Ansichtswechsel einblenden, bei geöffneter Tastatur ausblenden. Die Formularaktionen richten sich nach dem sichtbaren Bildschirmbereich.

## Büroplanung

| Bereich | Mobile Funktionen |
| --- | --- |
| Laufend | Alle wiederkehrenden Einnahmen und Ausgaben, Volltextsuche und Nachladen großer Bestände. Die Monatsbilanz verwendet die gespeicherten Monatsbeträge. |
| Einmalig | Eigenständige Einnahmen und Ausgaben mit Gesamtbetrag, Datum und Kontoart. Jahresfilter einschließlich „Ohne Datum“. |
| Bilanz | Monatliche Einnahmen, Ausgaben und Überschuss sowie getrennte Summen der einmaligen Posten. Filter verändern die Gesamtbilanz nicht. |
| Filter | Art, Kontoart, Empfänger/Sender, vorhandene Personenzuordnung, Zahlungsfrequenz beziehungsweise Zeitraum sowie Sortierung. |
| Details und Formulare | Art, Posten, Geldempfänger/-sender, Kontoart, Zahlungsfrequenz, Gesamtbetrag, Monatsbetrag beziehungsweise Datum und die vorhandene Personenzuordnung. Neue Posten, Bearbeiten und bestätigtes Löschen bleiben verfügbar. |
| Personen | Aktive interne Personen mit Kennung aus dem vorhandenen Register. Klarnamen und Änderung der Zuordnung nur mit dem bestehenden Recht. Ohne dieses Recht erscheint die Kennung. Ein verspäteter oder fehlgeschlagener Registerabruf löscht keine bestehende Zuordnung. |
| Excel | Zusätzliche vollständige Postenliste ohne feste Zeilengrenze, einschließlich Personenangaben entsprechend der Berechtigung. Die bisherige Excel-Vorlage bleibt als eigener Export erreichbar. |
| Verbindungen | Buchhaltung, Bürokonten, Büroübersicht und Controlling. |

Das echte Planungsmodell besitzt weder ein Kategorienfeld noch einen Zahlungsstatus oder eigene Anlagen. Solche beispielhaften Mockup-Felder wurden deshalb nicht als funktionslose Eingaben ergänzt. Die Kontoauswahl verwendet die tatsächlichen Arten „Geschäftlich“ und „Privat“; einzelne Bankkonten werden weiterhin im Banking verwaltet. Belege und Originaldateien bleiben in der Buchhaltung.

Jährliche und halbjährliche Posten behalten ihren separat gespeicherten Monatsbetrag. Eine ausdrücklich eingetragene Null bleibt erhalten. Die historische Excel-Vorlage hat weiterhin feste Grenzen von 13–15 Zeilen je Bereich; die mobile Oberfläche weist bei größeren Beständen darauf hin und bietet die vollständige Liste an.

## Buchhaltung, Auszüge und Belege

| Bereich | Mobile Funktionen |
| --- | --- |
| Buchungsliste | Suche, Saldo der Auswahl, Beleganzahl, Status und Privatmarkierung; sämtliche Treffer über Nachladen erreichbar. |
| Buchungsfilter | Kontoart, Jahr, Buchungsstatus, Richtung, vorhandene/fehlende Belegzuordnung, Sortierung. |
| Buchungsdetails | Vollständiger Verwendungszweck, Datum, Gegenüber, Betrag, Währung, Kontoart, Status, Privatmarkierung mit Begründung, Ursprungsauszug, vorhandener Planungsposten und zugeordnete Belege. |
| Buchungsaktionen | Datum, Gegenüber, Zweck, Betrag und Kontoart bearbeiten; Privatmarkierung setzen/entfernen; bestätigtes Löschen; verknüpfte Belege und Auszug öffnen. |
| Kontoauszüge | Liste, Suche, Filter nach Kontoart/Jahr/Verarbeitung, Details einschließlich Fehlerstatus, Originaldatei herunterladen, Dateiname/Kontoart ändern und zu allen enthaltenen Buchungen springen. |
| Auszugsimport | CSV und Excel über die ursprüngliche Importlogik; PDF speichern und anschließend per KI auswerten. Große Dateien werden ohne Überlauf der JavaScript-Argumentliste kodiert. |
| Auszugsaktionen | Einzelne oder gefilterte Auszüge per KI analysieren; Auszug samt Buchungen löschen. Vor erneuter Einzelanalyse eines bereits eingelesenen Auszugs wird die Ersetzung seiner Buchungen erläutert und bestätigt. |
| Belege | Liste, Suche, Jahr, Zuordnung, unvollständige Felder und OCR-Verarbeitungszustand als eigene Filter. |
| Belegdetails | Datei, Aussteller, Rechnungsnummer, Datum, Betrag, Texterkennung, Uploaddatum, Dateityp und vollständige zugeordnete Buchung. Vorhandener OCR-Text bleibt lesbar. |
| Belegaktionen | Originaldatei herunterladen; vier Rechnungsfelder bearbeiten; manuell zuordnen oder lösen; KI-Analyse, KI-Zuordnung, Stempel-PDF und bestätigtes Löschen. Die manuelle Auswahl enthält Vorschläge und alle weiteren Buchungen. |
| Belegupload | PDF oder Bild über die gemeinsame Dateiauswahl hinzufügen; bestehende lokale Texterkennung und Felderkennung weiterverwenden. |
| Mehrfachauswahl | Einzelne Einträge sowie alle aktuellen Treffer auswählen/abwählen und nach Bestätigung löschen. Verdeckte Treffer anderer Filter werden nicht versehentlich mitgelöscht. |
| Exporte | Buchungsliste als PDF/Excel und zugeordnete Belegesammlung als PDF/Excel. Diese Ausgaben berücksichtigen die aktuelle mobile Suche und Filter. |
| Weitere Fachaktionen | KI-Analyse gefilterter Buchungen/Belege, KI-Zuordnung offener Belege, Empfänger aus dem Zweck ableiten, private Buchungen vorschlagen und alle als privat markierten Buchungen löschen. Bestandsweite Aktionen sind ausdrücklich entsprechend beschriftet. |

Die vorhandenen Endpunkte und Fachgeneratoren bleiben Grundlage. Die lokalen Buchhaltungsdaten und Dateien bleiben wie bisher sitzungsbezogen. Der lokale Adapter unterstützt jetzt zusätzlich die Änderung von Auszugsmetadaten, das Lesen gespeicherter Originaldateien/OCR-Texte und das korrekte Lösen betroffener Belegverbindungen beim Entfernen oder erneuten Einlesen eines Auszugs. Die Büroplanung verwendet weiterhin ihren vorhandenen lokalen Speicherweg.

## Büroübersicht und Controlling

Die Büroübersicht behält ihre Kennzahlen, zwölf Arbeitsvorräte, Diagramme und Bereichssprünge. Das Blatt „Finanzbereiche“ erschließt Übersicht, Konten und Zahlungen, Buchungen, Belege, Auszüge, Planung und das berechtigte Controlling. Der Kontenzugang führt in das bereits umgebaute mobile Banking.

Im Controlling bleiben Fallbestand, Wohnform, Vermögensstatus, Betreuungsdauer, Monatswerte, Auslastung je Betreuer, Personalkosten, Bestandsalterung und Zu-/Abgänge verfügbar. Die bestehende Pflegeaktion führt weiter zur Datenadministration. PDF- und Excel-Ausgaben verwenden die ursprünglichen Generatoren. Der bisherige Hinweis, dass büroweites Controlling den Serverbetrieb benötigt, bleibt bestehen.

## Zuverlässigkeit

- Formulare bleiben bei Chatwechsel, Hintergrundaktualisierung und Breitenwechsel erhalten. Auch bereits auf dem Desktop begonnene Eingaben werden ins mobile Formular übernommen und beim Verlassen als Änderungen behandelt.
- Während eines Schreibvorgangs sind Mehrfachbedienung und Verlassen gesperrt. Fehlgeschlagenes Speichern lässt den Entwurf offen.
- Vor dem Bearbeiten oder Löschen eines Planungspostens sowie dem Speichern eines Buchhaltungsformulars wird der aktuelle Datensatz mit dem Ausgangsstand verglichen. Das verhindert das Überschreiben einer bereits erkennbaren zwischenzeitlichen Änderung. Dieser clientseitige Vergleich ersetzt keine atomare Versionsprüfung auf dem Server; Änderungen zwischen Vorprüfung und Schreibzugriff bleiben eine bestehende Grenze.
- Die vier Buchhaltungslisten werden gemeinsam übernommen. Ein fehlgeschlagener Teilabruf oder eine verspätete ältere Antwort ersetzt keinen neueren vollständigen Stand. Fehler werden sichtbar angezeigt.
- Personenkennungen, zusätzliche vorhandene Metadaten und Nullbeträge bleiben beim Speichern erhalten. Entzogene Klarnamenrechte wirken auch auf bereits geladene Namen in den neuen Planungsansichten.

## Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| Bürofinanzen im Browser | **73 bestanden**: Planung, vollständige Formulare, Personenrechte, Filter, Zuordnung, Fehler/Konflikte, Chat, Tastatursimulation, Scrollnavigation, Größenwechsel und ursprüngliche Desktopansichten. |
| Dateien und Fachgeneratoren | Tatsächlicher PDF-Upload mit lokalen OCR-Komponenten, CSV über 180 kB mit 140 Buchungen, Originaldatei, Stempel-PDF, Belegesammlung und Excel-Ausgaben. KI-Antworten lokal vorgegeben; Übergabe und Speicherung über die tatsächlichen Fachfunktionen geprüft. |
| Banking-Regression | **64 Browserprüfungen bestanden.** |
| Darstellung | Büroplanung und Buchhaltung hell/dunkel bei 320, 360, 390 und 430 Pixeln ohne horizontalen Überlauf. Befülltes Controlling zusätzlich bei 320 Pixeln geprüft; Details, Filter und Formulare visuell kontrolliert. |
| Gezielte mobile Tests | **183 bestanden**, einschließlich 20 neuer Bürofinanz-Funktionstests und Syntaxprüfung aller 229 ausführbaren JavaScript-Blöcke. Nach der abschließenden Größenwechselkorrektur erneut erfolgreich ausgeführt. |
| Weitere bestehende Prüfungen | **53 bestanden**, unter anderem Finanzdarstellung, lokale Datenwege, Ladepakete und mobile Basis. |
| Vollständige Suite | **1.337 Tests: 1.333 bestanden, 3 bereits bekannte Fehler, 1 übersprungen.** Der abschließende Größenwechsel wurde anschließend mit den 73 Browserprüfungen und 183 gezielten Prüfungen verifiziert. |
| Dateiintegrität | 311 Scriptblöcke, alle 82 eingebetteten Datenblöcke und das vorhandene NUL-Byte erhalten. Nur die drei Finanz-Scriptblöcke und der bestehende mobile CSS-Block wurden geändert. Alle übrigen Bytes entsprechen dem Arbeitsstand zu Beginn dieser Umsetzung. |

Die drei bekannten Suite-Fehler betreffen die Backup-/Recovery-Registrierung von `office_ai_config.allowed_models` und den V230-PDF-Golden-Vergleich. [Nachweis am ursprünglichen Ausgangsstand](mobile-fundament-v1/baseline-fehler.txt). Die testbedingt veränderte PDF-Golden-Datei wurde wiederhergestellt.

Die Browserprüfungen verwenden die tatsächliche App mit synthetischen Datensätzen und abgefangenen Serverantworten. Echte externe KI- und Bankdienste, produktive Serverzugriffe und eine physische iPhone-Tastatur wurden nicht geprüft. Die vorhandene PDF-OCR-Seitengrenze bleibt unverändert. Es wurden keine Produktivdaten geändert, keine Zahlungen eingereicht und keine Änderungen veröffentlicht.

## Nachweise

- [Bürofinanzen: Browserprüfung](mobile-buerofinanzen-v1/finanzen-browser.txt)
- [Banking: Wiederholungsprüfung](mobile-buerofinanzen-v1/banking-regression.txt)
- [Gezielte mobile Tests](mobile-buerofinanzen-v1/gezielte-tests.txt)
- [Weitere bestehende Prüfungen](mobile-buerofinanzen-v1/bestehende-tests.txt)
- [Vollständige Suite](mobile-buerofinanzen-v1/vollstaendige-testsuite.txt)
- [Bytevergleich und SHA-256](mobile-buerofinanzen-v1/integritaet.json)
