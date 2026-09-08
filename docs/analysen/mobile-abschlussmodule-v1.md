# Mobile Abschlussmodule

Stand: 08.09.2026. Lokaler Arbeitsstand auf `codex/mobile-foundation-chats`, Release-Basis v0.7.7. Die **32 aktivierten Hauptmodule** der ursprünglichen Bestandsaufnahme besitzen jetzt eine mobile Darstellung im gemeinsamen Stil. Davon wurden in diesem Paket zwölf Bereiche umgesetzt oder vervollständigt. Die separat über die Schnellaktionen erreichbare Rechnungslegung war bereits umgesetzt.

[Galerie: 48 tatsächliche App-Ansichten](mobile-abschlussmodule-v1/ansichten.html) · [Vollständiger Umsetzungsstand als JSON](mobile-umsetzungsstand-2026-09-08.json)

## Kalender

Der Kalender war bereits umgebaut. Er wurde zuerst anhand der Implementierung und mit dem vorhandenen Browserlauf erneut geprüft: **46 erfolgreiche Prüfungen**. Tages-, Wochen- und Monatsansicht, Suche, Filter, Termindetails, Formulare, Anlagen, Serien, Erinnerungen und der vorhandene Rasterzugang bleiben erhalten. [Vorherige Umsetzung und Umfang](mobile-kalender-v1.md).

## In diesem Paket fertiggestellt

| Bereich | Mobile Bedienung und erhaltene Fachfunktionen |
|---|---|
| Gesundheit | Suchbare Einträge mit Bereichsfilter, separate Details und geschützte Formulare. Allgemeine Angaben, sieben Arten von Verlaufseinträgen, Diagnoseanmerkungen und sonstige Hinweise. Alle 16 Vollmachten/Verfügungen jeweils mit Status und Aufbewahrung. ICD-Recherche, Adressbuchübernahmen, KI-Dokumentenanalyse und alle drei vorhandenen PDF-Ausgaben. |
| Wohnen | Adressen, Wohnkosten und vier Arten von Verlaufseinträgen. Filter für Eintragsart, Zeitraum/Jahr und laufende bzw. beendete Einträge. Vollständige bestehende Adressfelder einschließlich Auslandsadressen, Wohnkosten, Adressbuchwahl und Kopierfunktionen. Die ursprüngliche Stammdaten- und Berichtssynchronisierung bleibt erhalten. |
| Fähigkeiten & Alltag | Alle elf Bereiche mit eigenständigen Details und den jeweils passenden Formularen. Filter für Erfassungsstand, fällige Prüfung und verknüpfte Bedarfe. Ressourcen, Schwierigkeiten, Alltag, Wünsche, Quellen, Prüftermine, Berichtsverwendung und bestehende Verknüpfungen. Bereichswechsel und Änderungsverlauf. |
| Wünsche und Bedarfe | Alle sechs Eintragsarten, Suche und eigene Fall-, Typ-, Status-, Bereichs- und Prüffilter. SMART-Ziele und Entscheidungsdokumentation behalten ihre vollständigen Fachfelder. Typwechsel erhält vorhandene Eingaben. Modulverknüpfungen, alle vorhandenen Weiterarbeitsaktionen, Dokumentenanalyse, PDF und Berichtsübernahme bleiben erreichbar. |
| Genehmigungen | Acht ursprüngliche Eingabefelder und sämtliche sieben bestehenden Statuswerte. Suche, Kategorie-, Status-, Offen/Abgeschlossen- und Willensfilter. Dokumentübergabe, KI-Erfassung samt Anlagen, PDF/Excel und automatische Dokumentation. |
| Kontaktmonitor | Personenliste mit Status-, Turnus- und Fallfilter; Einzelansicht mit Kontaktverlauf. Kontakt erfassen, Turnus ändern, Profil öffnen und die vier bisherigen Ausgaben. Kontakte werden über den bestehenden Ablauf in den Betreuungsverlauf gespiegelt. Speicherfehler bleiben sichtbar. |
| Betreuungsübersicht | Fallliste, Suche sowie Gerichts-, Änderungs- und Unterbringungsfilter. Alle zwölf vorhandenen Angaben bleiben lesbar. Zeitraum und aktive/archivierte Fälle sind auswählbar. Bearbeitbar sind die tatsächlich separat gespeicherten Meldeangaben; Speichern wartet auf den bestehenden Server-Endpunkt. PDF, Excel und Aktualisieren bleiben erreichbar. |
| Posteingang | Dokumentenliste und separate Einzelprüfung. Suche, Bearbeitungsstand sowie bisherige Tages- und Fallfilter. Upload, OCR, KI direkt oder über JSON, Vorschläge bearbeiten/ergänzen/entfernen, Fachaktionen übernehmen, Dateiablage und Download. Feste OCR-, KI- und Übernahmeaktionen; Auswahl aktiviert den Übernahmebutton sofort. Auch die Sammelwerkzeuge bleiben erreichbar. |
| Qualifikationen | Personenliste mit Rollen-, Einstufungs- und Nachweisfilter. Detailansicht, vollständiges geschütztes Formular, Fortbildungen, Sonderaufgaben, Nachweisdateien und Downloads. Mitarbeiteranlage unter den vorhandenen Rechten sowie Profil-/Tabellenexporte. Uploads erhalten laufende Eingaben, auch bei einer Rückkehr aus dem Chat. Serverfehler schließen den Entwurf nicht. |
| Archivierte Formulare | Suchbare Fassungen, Jahres-/Dokument-/Fallfilter, eigene Detail- und Bearbeitungsansicht für Namen und Notizen. Vorlagenübernahme, bevorzugte Fassung, lokale Vorschläge, KI-Zusammenfassung, JSON und Löschen. Fall- und Büroarchiv verwenden ihre jeweiligen ursprünglichen Speicher. |
| Export- und Versandhistorie | Liste, Einzelansicht, Suche, Jahresfilter und ursprüngliche Versandfilter. Empfänger/Betreff, Notizen, Kopieren, Mail/eBO/Fax-Zugänge, alle Versandbestätigungen, JSON und Löschen. Fall- und Bürohistorie bleiben getrennt gespeichert. |
| Fallübersicht | Gemeinsame Kopfzeile, Suche, Filterblatt und einzelne Einträge. Wiedervorlagen bleiben erreichbar; sämtliche **30 Schnellaktionen** stehen im Aktionsblatt bereit. Der bestehende Fachdialog wird beim Aufruf in die sichtbare Arbeitsebene übernommen. |

Der Posteingang behält bewusst seine bestehende fortlaufende Übernahme von Metadaten und Vorschlagsauswahl. Die ausdrücklich ausgelöste Übernahme führt anschließend die ausgewählten Fachaktionen aus. Die anderen neu aufgebauten Eingabeformulare verwenden einen Entwurf mit Speichern/Abbrechen.

## Vollständiger Stand der Hauptmodule

| Nr. | Hauptmodul | Stand |
|---:|---|---|
| 1 | Start | Vorher umgesetzt |
| 2 | KI-Fallchat / Chats-Zugang | Vorher umgesetzt |
| 3 | Stammdaten | Vorher umgesetzt |
| 4 | Fallübersicht | In diesem Paket vervollständigt |
| 5 | Falldokumentation | Bestehende Referenzansicht |
| 6 | Kalender | Vorher umgesetzt, erneut geprüft |
| 7 | Aufgaben | Vorher umgesetzt |
| 8 | Fristen | Vorher umgesetzt |
| 9 | Wiedervorlagen | Vorher umgesetzt |
| 10 | Adressbuch | Vorher umgesetzt |
| 11 | E-Mail | Vorher umgesetzt |
| 12 | Datei-Explorer | Vorher umgesetzt |
| 13 | Archivierte Formulare | In diesem Paket umgesetzt |
| 14 | Export- und Versandhistorie | In diesem Paket umgesetzt |
| 15 | Banking | Vorher umgesetzt |
| 16 | Handkasse | Vorher umgesetzt |
| 17 | Vermögensaufstellung | Vorher umgesetzt |
| 18 | Lebensunterhalt | Vorher umgesetzt |
| 19 | Schuldenregulierung | Vorher umgesetzt |
| 20 | Gesundheit | In diesem Paket umgesetzt |
| 21 | Wohnen | In diesem Paket umgesetzt |
| 22 | Fähigkeiten & Alltag | In diesem Paket umgesetzt |
| 23 | Wünsche und Bedarfe | In diesem Paket umgesetzt |
| 24 | Genehmigungen | In diesem Paket umgesetzt |
| 25 | Kontaktmonitor | In diesem Paket umgesetzt |
| 26 | Betreuungsübersicht | In diesem Paket umgesetzt |
| 27 | Posteingang | In diesem Paket umgesetzt |
| 28 | Finanzen | Vorher umgesetzt |
| 29 | Ausgangsrechnungen | Vorher umgesetzt |
| 30 | Fahrtkosten | Vorher umgesetzt |
| 31 | Qualifikationsmanager | In diesem Paket umgesetzt |
| 32 | Benutzermenü | Vorher umgesetzt |

## Gemeinsames Verhalten

Die neuen Oberflächen verwenden die vorhandene mobile Grundlage: dunkelblaue Kopfzeile, flache Listen, getrennte Details/Formulare, modulspezifische Filterblätter und erreichbare Aktionen. Die Formulare behalten ihre tatsächlichen Datenfelder, Fachfunktionen und Speicherwege. Es wurden keine zusätzlichen Zuständigkeitsfelder oder parallelen Datenmodelle erfunden.

Der Chats-Zugang einschließlich Mitarbeiterchat-Badge bleibt erhalten. Die Navigation folgt weiterhin den vereinbarten Regeln: abwärts ausblenden, aufwärts sowie am Listenanfang und beim Ansichtswechsel einblenden, bei geöffneter Tastatur ausblenden. Formularaktionen bleiben im sichtbaren Bereich. Ungespeicherte Änderungen erhalten einen Verwerfschutz; bei den gemeinsamen Datensatzformularen werden Fallwechsel und zwischenzeitliche Datensatzänderungen vor dem Schreiben erkannt.

## Prüfung und technische Grenzen

| Prüfung | Ergebnis |
|---|---|
| Neue Abschlussmodule im tatsächlichen HTML | **143 Prüfungen erfolgreich**, keine JavaScript-Laufzeitfehler. Einschließlich aller Gesundheits- und Planungsformulararten, Spezialbereiche des Fähigkeitenprofils, Chat-Rückkehr, simulierter Tastatur, Speicherfehlern, Nachweis-Upload, Archivbearbeitung und Bürovarianten. |
| Kleine Ansichten und Farbschemata | 320, 390 und 430 Pixel, jeweils hell und dunkel. Keine horizontale Überbreite der geprüften Hauptansichten; Aktionsleisten innerhalb des sichtbaren Bereichs. |
| Desktop | Alle zwölf in diesem Paket berührten Hauptmodule öffnen weiterhin ihre vorhandene Desktopansicht. |
| Vorhandene mobile Tests und abschließende Syntaxprüfung | **205 erfolgreich**, keine Fehler. Alle 229 ausführbaren JavaScript-Blöcke sind syntaktisch gültig. |
| Kalender, mobile Grundlage und Navigation | Bestehende Browserläufe erneut erfolgreich. |
| Gesamte Testsuite | **1.355 erfolgreich, 1 übersprungen, 3 bekannte Bestandsfehler** bei insgesamt 1.359 Tests. Anschließend wurden die letzten mobilen Korrekturen nochmals mit den gezielten Tests und dem Browserlauf geprüft. |
| Dateiintegrität | 311 Scriptblöcke, davon 82 eingebettete Datenblöcke unverändert. Änderungen nur innerhalb von elf vorhandenen JavaScript-Blöcken und dem mobilen Stylesheet; übriges HTML byteidentisch zum Arbeitsstand vor diesem Paket. |

Die drei Bestandsfehler betreffen zweimal die bestehende Schema-Erwartung für `office_ai_config.allowed_models` und einmal die vorhandene V230-PDF-Golden-Referenz. Vergleichsbeleg: [dokumentierte Ausgangsfehler](mobile-fundament-v1/baseline-fehler.txt). Die von der Gesamtsuite veränderte Golden-PDF wurde anschließend auf den zuvor sauberen Repositorystand zurückgesetzt.

Die Browserprüfungen verwenden Chromium mit Smartphone-Viewport und Touch-Einstellung sowie synthetische Fälle und abgefangene Serverantworten. Sie ersetzen keine Abnahme auf einem echten iPhone/Android-Gerät. Externe Dienste, echte OCR/KI-Anbieter, Bankzugänge, Mailversand und die vollständige Rechtekonfiguration eines Produktivkontos wurden nicht live ausgeführt. Die bestehende fachliche Speicherung und deren Fehlerverhalten werden weiterverwendet; dieses Paket führt keine neue Transaktions- oder Serverarchitektur ein.

Die Änderungen sind lokal; es erfolgte keine Veröffentlichung.

## Nachweise

- [Browserprüfung der Abschlussmodule](mobile-abschlussmodule-v1/browser-pruefung.txt)
- [Gezielte Tests](mobile-abschlussmodule-v1/gezielte-tests.txt)
- [Gesamtsuite](mobile-abschlussmodule-v1/vollstaendige-testsuite.txt)
- [Kalender erneut geprüft](mobile-abschlussmodule-v1/kalender-regression.txt)
- [Mobile Grundlage](mobile-abschlussmodule-v1/fundament-regression.txt)
- [Navigationsregeln](mobile-abschlussmodule-v1/navigation-regression.txt)
- [Bytevergleich und SHA-256](mobile-abschlussmodule-v1/integritaet.json)
- [Wiederholbarer Browserlauf](../../server/scripts/qa-mobile-completion.cjs)
