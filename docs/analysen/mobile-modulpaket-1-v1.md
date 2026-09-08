# Mobile Umstellung: erstes Modulpaket

Fristen, Wiedervorlagen, Adressbuch und Stammdaten verwenden die neue mobile Gestaltung. Umgesetzt am 07.09.2026 auf Release v0.7.7 (`9b28c434343743b116da66f37cb88d0b7cbc2019`), aufbauend auf dem gemeinsamen Fundament und dem Aufgabenpilot. Die Änderungen liegen lokal auf `codex/mobile-foundation-chats`; sie sind nicht veröffentlicht.

Diese Etappe umfasst die vier zusammenpassenden Bereiche aus Schritt 1. Schritt 2 ist als anschließende Folge einzelner Umbauten vorbereitet. Kalender, E-Mail, Datei-Explorer, Banking, Ausgangsrechnungen und die weiteren Finanzmodule sind durch dieses Paket noch nicht auf die neuen Ansichten umgestellt.

Die Umsetzung orientiert sich an den freigegebenen Mockups: dunkle Kopfzeile, flache Listen, eigene Detail- und Formularseiten, passende Filterblätter und feste Formularaktionen. Die untere Navigation folgt weiter dem vereinbarten Scroll- und Tastaturstandard. Chats und Mitarbeiterchat-Badge bleiben Teil der gemeinsamen Navigation.

## Fristen

| Zugang | Funktionsumfang |
| --- | --- |
| Liste | Eigene und gesetzlich abgeleitete Fristen; Gruppierung, Fall, Fälligkeit und Status; Neuanlage über Plus |
| Suche | Titel, Fristkategorie, Verfahrensbezeichnung, Institution, Notiz und Fall |
| Filter | Aktueller Fall, alle Fälle oder einzelner Fall; offen/erledigt/alle; alle ursprünglichen Kategorien; Priorität; Herkunft einschließlich KI und Schuldenregulierung; überfällig, nächste sieben Tage, restlicher Monat und bestehende Zeithorizonte |
| Details | Vollständige Fristangaben; bearbeiten, abschließen und wieder öffnen; Löschen über Mehr |
| Formular | Originalfelder für Titel, Kategorie, Verfahren, Institution, Bescheid- und Fälligkeitsdatum, Berechnungshilfe, Wiederholung, Kalender-/Aufgabeneintrag, Vorlauf, Priorität, Notiz und Status |
| Fachabläufe | Bestehende Fallwechsel- und Speicherlogik, Serienfortschreibung beim Abschluss, Routing und verknüpfte Planung bleiben angeschlossen |
| Abgeleitete Fristen | Übernahme im passenden geöffneten Fall; Herkunft und Hinweis zur Prüfung bleiben sichtbar |
| Schuldenfristen | Ursprung bleibt beim Schuldenmodul; die Fristenansicht bietet die vorhandenen Routing-Schalter |
| Werkzeuge | Dokumentenanalyse über den ursprünglichen Upload, Aktualisierung und Vergütungszugang |

## Wiedervorlagen

| Zugang | Funktionsumfang |
| --- | --- |
| Liste | Fällig, Geplant, Erledigt und Alle; auch Vorgänge aus anderen Fällen und abgeleitete Überprüfungen |
| Suche und Filter | Titel, Notiz, Fall und Herkunft; Fall-ID, Fälligkeit, Priorität und Ursprungsmodul |
| Details | Status, Termin, Priorität, Fall, Notizen, Anlagen und Ursprungsreferenz; direkter Zugang zum Ursprung |
| Status | Verlängern um 14 Tage, beenden und wieder öffnen über die bestehenden Funktionen |
| Formular | Originalfelder und Ursprungs-Auswahl; Quelle und Fall bleiben beim Speichern erhalten; feste Aktionen |
| Erweiterte Bearbeitung | „Bearbeiten mit Anlagen und Wiederholung“ führt zur bestehenden Aufgabenmaske mit derselben Datensatz-ID |
| Abgeleitete Überprüfungen | Öffnen ihren fachlichen Ursprung; es wird keine künstliche Aufgabe angelegt |
| Weitere Aktionen | Löschen, Aktualisieren, Fallübersicht und Schnellaktionen bleiben erreichbar |

Beim Beenden innerhalb einer bearbeiteten Wiedervorlage werden auch die geänderten Formularangaben gespeichert. Ein fehlender Ursprungsdatensatz wird kenntlich gemacht; die gespeicherte Referenz bleibt erhalten.

## Adressbuch

| Zugang | Funktionsumfang |
| --- | --- |
| Liste | Alle, Personen und Institutionen; bestehende aktive/beendete Kontakte, Auswahl und Buchstabenleiste |
| Filter | Fallkontakte, alle Kontakte oder Bürokontakte; Status, Ort, Rolle, Institution, Kontaktart, Sortierfeld, Richtung und Namensdarstellung |
| Suche | Vorhandene Suche über Kontaktfelder einschließlich Akten-/Vorgangsreferenzen |
| Kontaktseite | Kontaktdaten und Anschrift mit bestehenden Links; Anruf, interne E-Mail und Bearbeiten; zusätzliche lesbare Bank-/Vorgangsreferenzen |
| Kontaktaktionen | Originalaktionen für Dokumentempfänger, Status, Kopieren, interne/externe E-Mail, Fax, Löschen und Fremdfallzugang |
| Formular | Originale Kategorien und Felder einschließlich getrennter Telefon-/Mobil-/Faxvorwahlen, Anschrift, Postfach, Aktenzeichen, Vorgangsnummer, IBAN, BIC und Bankname |
| Werkzeuge | Excel-Ausgabe, vCard-Import/Export, Online-Kontaktimporte und -exporte, Duplikate/Zusammenführen sowie Sammelauswahl und Sammelstatus im jeweils bisherigen Kontext |

Die tatsächlichen bestehenden Steuerelemente werden in das Filter- bzw. Aktionsblatt verschoben. So bleiben Dateieingaben, Exportkontext und Ereignisbehandlungen erhalten. Ein Wechsel zwischen Fall- und Bürokontakten schließt das Filterblatt vor dem Neuaufbau. Statusänderungen und Löschungen aktualisieren die Liste. Ein Kategorienwechsel im Kontaktformular erhält bereits eingegebene Werte der weiter vorhandenen Felder.

Bürokontakte verwenden einen anderen Speicherweg als Fallkontakte. Mobile Bürokontaktformulare warten jetzt auf dessen Serverantwort; bei Fehler bleibt das Formular einschließlich Speicherfunktion für einen erneuten Versuch erhalten. Die übrigen ursprünglichen Kontakt-Synchronisationswege bleiben bestehen; dieses Paket ersetzt keine Server-Synchronisation.

## Stammdaten

Alle 13 vorhandenen Datenabschnitte bleiben erreichbar. Die Startseite des Moduls bietet gezielte Bereichseinstiege, Suche und die Gruppen Person, Betreuung, Kontakte und Weitere. Das Filterblatt grenzt nach Gruppe und „Mit Angaben“/„Ohne Angaben“ ein. Der Datenstand ist keine Prüfung auf fachliche Vollständigkeit.

Ein Bereich öffnet als eigene Seite mit den ursprünglichen Feldern. Änderungen werden weiterhin laufend übernommen. Die spezialisierten Editoren für Kontakt/Anschrift und soziales Netzwerk verwenden die gemeinsamen mobilen Kopfzeilen und Formularaktionen. Die ursprünglichen Eingabeelemente und ihre Listener bleiben erhalten. Nach einem Neuaufbau der Stammdaten wird der ausgewählte Bereich wieder geöffnet.

## Gemeinsamkeiten und Vorbereitung von Schritt 2

Das gemeinsame UI-Objekt ist auf Version 2 erweitert. Es bietet Ansichtsrahmen, Formularaktionen, Abschnittsdarstellung, Auswahlelemente und Eingabeschutz. Moduladapter bestimmen die Inhalte, Filter und fachlichen Aktionen. Datenspeicherung und Zuordnungen bleiben in den bestehenden Modulen.

- Geänderte Formulare werden beim Abbrechen, Schließen und Wechsel über die mobile Navigation geschützt.
- Laufende Speichervorgänge blockieren einen versehentlichen Wechsel.
- Fristen- und Wiedervorlagenformulare bleiben bei Aktualisierungen bestehen.
- Chat-Ausflüge erhalten weiterhin die tatsächlichen Formularfelder.
- Eingabe- und Aktionsbereiche berücksichtigen die Bildschirmtastatur; Kopfaktionen haben mindestens 44 × 44 px große Touchflächen.
- Desktopansichten nutzen weiterhin ihre bisherigen Darstellungen.

Für die anschließenden Einzelumbauten sind diese Abnahmepunkte vorgesehen. Die genannten Funktionen stammen aus den bestehenden Modulen; Beispielwerte und Beispiel-Filter im Mockup werden nicht als neue Datenfelder eingeführt.

| Einzelumbau | Eigener Ablauf und Prüfschwerpunkte |
| --- | --- |
| Kalender | Tag/Woche/Monat/Liste, Navigation und Agenda-Zeiträume; Fall-/Schlagwortfilter, Kalender-/Listen-Sichtbarkeit und Farben; Termin lesen/bearbeiten, Ganztag und Mehrtag, Serien, Erinnerung, Ort/Online-Link, Speicherort, Anlagen, ICS und Synchronisierung. Vorhandene Querverknüpfungen zu Aufgaben/Fristen/Wiedervorlagen erhalten. Teilweise fehlgeschlagene Anlagen-Uploads müssen ohne doppelten Termin wiederholbar werden. |
| E-Mail | Konto/Ordner → Nachrichtenliste → Lesen → Verfassen/Antworten/Weiterleiten; Empfänger, Entwürfe, Anhänge, Nachrichtenaktionen und Versandstatus. Eigene Rückwege und Schutz des Nachrichtenentwurfs prüfen. |
| Datei-Explorer | Fall/Ordner → Liste oder Kacheln → Vorschau; Suche, Mehrfachauswahl, Dateikontext, Upload und bestehende Bearbeitungs-/Versandaktionen. Dateiauswahl aus anderen Formularen muss zu genau diesem Formular zurückkehren. |
| Banking | Kontowahl → Umsätze/Abgleich bzw. Zahlungsaufträge; Filter und Konto-Kontext getrennt halten. Überweisung, Freigabe/Bestätigung, Status und wiederkehrende Zahlungen jeweils über den bestehenden Ablauf prüfen. |
| Ausgangsrechnungen | Rechnungsliste/Status → Rechnung → Positionen bearbeiten; Empfänger, Fallbezug, Beträge, Fälligkeit, PDF/Export und vorhandene Zahlungs-/Mahnaktionen. |
| Bürofinanzen | Laufende/einmalige Posten, Bilanz, Bürokonten, Belege, Buchhaltungszuordnung und Exporte. |
| Handkasse | Fall/Jahr, Saldo und Buchungen; Beleg, PDF/Excel und Rechnungslegung. |
| Vermögensaufstellung | Anfang/Abschluss sowie Schulden Anfang/Ende; Positionen und Berichtsanbindung. |
| Lebensunterhalt | Einnahmen/Ausgaben, Monatsbilanz und Dokumentenübernahme. |
| Schuldenregulierung | Forderungen, Gläubiger, Raten/Zahlungen, Fristenverknüpfungen und Dokumentenauswertung. |
| Fahrtkosten | Fahrtliste, Strecken/Kilometer, Erfassung und Nachweise. |

## Prüfstand

- **114 gezielte Tests erfolgreich**, darunter Frist-/Wiedervorlagenfilter, mobile Ansichten, Fallkontext, Kontaktfelder, Stammdaten und Fristen-Synchronisation.
- **61 Browserprüfungen für dieses Paket erfolgreich**: Listen, Filter, Bearbeiten, Neuanlage, Status, Ursprungsreferenzen, Entwurfs-/Fehlerfälle, Chats, Sammelauswahl, Fall-/Büro-Umschaltung und Desktop.
- Zusätzliche Browserregressionen: **42 Aufgabenprüfungen**, **23 Navigationsprüfungen** sowie der vollständige bestehende Lauf für Dokumentation und Chats erfolgreich.
- Hell/Dunkel und 320–430 px geprüft; Kopfaktionen und Ansichtsgrenzen geometrisch geprüft. Die Tastaturprüfung simuliert einen verkleinerten VisualViewport.
- Alle **229 JavaScript-Blöcke** der HTML-Datei sind syntaktisch gültig; **311 Script-Blöcke** insgesamt.
- Vollständige Suite: **1.232 Tests, 1.228 erfolgreich, drei fehlgeschlagen, einer übersprungen**. Die Fehler entsprechen den bereits am unveränderten Release nachgewiesenen Fehlern: Backup-Registrierung und Recovery-Bootstrap (`office_ai_config.allowed_models`) sowie V230-PDF-Golden-Rendering. [Bisheriger Nachweis](mobile-fundament-v1/baseline-fehler.txt).

Die Browserläufe verwenden die echte ausgelieferte HTML-App mit synthetischen Daten und abgefangenen Serverzugriffen. Es wurden keine Produktionsdaten geschrieben. Eine Abnahme auf physischen Smartphones und mit echten Mehrbenutzerkonten ist damit noch nicht erfolgt.

## Nachweise

[Ansichtsgalerie](mobile-modulpaket-1-v1/ansichten.html) · [Browserprüfungen](mobile-modulpaket-1-v1/browser-pruefung.txt) · [Gezielte Tests](mobile-modulpaket-1-v1/gezielte-tests.txt) · [Gesamtsuite](mobile-modulpaket-1-v1/vollstaendige-testsuite.txt)

[Aufgaben-Regression](mobile-modulpaket-1-v1/aufgaben-regression.txt) · [Navigation](mobile-modulpaket-1-v1/navigation-regression.txt) · [Dokumentation/Chats](mobile-modulpaket-1-v1/fundament-regression.txt)

Reproduktion: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright node server/scripts/qa-mobile-modules.cjs`. Zusätzliche Filter-Verhaltenstests: `server/tests/html-mobile-module-package.test.cjs`.
