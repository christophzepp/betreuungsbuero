# Mobile Ansichten: Lebensunterhalt und Schuldenregulierung

Stand: 07.09.2026. Umsetzung in der gewünschten Reihenfolge auf dem bestehenden mobilen Arbeitsstand, Release-Basis v0.7.7. Die Änderungen liegen lokal in `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html`.

[Galerie mit 30 tatsächlichen App-Ansichten](mobile-lebensunterhalt-schuldenregulierung-v1/ansichten.html)

## Lebensunterhalt

Das Modul verwendet die gemeinsame mobile Kopfzeile, drei Bereiche für Einnahmen, Ausgaben und Bilanz, vollständige Positionsdetails, geschützte Formulare, ein Filterblatt und fest erreichbare Aktionen.

| Bereich | Mobile Funktionen |
| --- | --- |
| Einnahmen und Ausgaben | Vollständige Listen mit Nachladen großer Bestände, Volltextsuche und getrennten Monatssummen. Die Gesamtbilanz des Falls bleibt von Anzeige-Filtern unabhängig. |
| Bilanz | Monatliche Einnahmen, Ausgaben und verfügbarer Betrag; Aufschlüsselung nach Kategorien. |
| Filter | Kategorie, Zahlintervall, Status, Herkunft beziehungsweise Stammdatenverknüpfung und Sortierung. Die Auswahlmöglichkeiten stammen aus dem vorhandenen Bestand. |
| Details | Alle sechs ursprünglichen Einnahmefelder beziehungsweise acht Ausgabefelder, zusätzlich vorhandene Angaben zu Aktenzeichen, Gültigkeit, Bescheiddatum, Rechtsgrundlage, Hinweis, Unterlagenart und Herkunft. |
| Einnahme erfassen/bearbeiten | Kategorie, Bezeichnung, Leistungsträger, Zahlintervall, Gesamtbetrag und monatlicher Betrag. |
| Ausgabe erfassen/bearbeiten | Kategorie, Bezeichnung, Gläubiger, Zahlintervall, Gesamtbetrag, monatlicher Betrag, Status und Ende der Ratenzahlung. |
| Löschen | Bestätigung vor dem Entfernen; verknüpfte Leistungen werden über die bestehende Zuordnung mit entfernt. |
| Leistungen | Vorhandene Übernahme aus Stammdaten und Synchronisierung der Einnahmen mit den Leistungen. Wiederholtes Laden erhält bestehende Zuordnungen. |
| Unterlagen auswerten | Bestehende Dateiauswahl und Dateiverarbeitung für Bescheide/Kontoauszüge; anschließend vollständige Vorschläge mit Einzelauswahl. Erst „Ausgewählte übernehmen“ schreibt die Daten. |
| Fall und Berichte | Vorhandene Fallauswahl und Übergabe an Jahresbericht mit Vermögenssorge beziehungsweise Rechnungslegung. Der bewusst ausgewählte Berichtsfall bleibt geöffnet. |

Die bestehenden Arrays `livelihood.income` und `livelihood.expenses` bleiben die Datenquelle. Der Monatsbetrag ist weiterhin ein eigenes gespeichertes Feld: Das Modul berechnet ihn nicht neu aus Gesamtbetrag und Zahlintervall. Die Bilanz erklärt dies ausdrücklich. Von der Schuldenregulierung übernommene Raten bleiben vollständig lesbar und werden weiterhin dort gepflegt.

Die Einnahmensynchronisierung bewahrt jetzt auch ausdrücklich eingetragene Nullbeträge. Zuvor konnte die Verwendung von `||` einen alten Leistungsbetrag wieder einsetzen. Beim mobilen Speichern werden die synchronen Zwischen-Speicheraufrufe der Berichtsvorbereitung zusammengefasst; der vollständige Datenstand wird einmal gespeichert. Zusätzliche importierte Metadaten bleiben bei der Bearbeitung erhalten.

Die ursprüngliche Berichtslogik bleibt erhalten: Der Jahresbericht übernimmt Einnahmen und Abschlussvermögen; die Rechnungslegung öffnet ihren vorhandenen Vermögensimport. Es wurde keine zusätzliche automatische Ausgabenübernahme in die Rechnungslegung eingeführt.

## Schuldenregulierung

Das Modul erhält eigene Bereiche für Forderungen und Einzelzahlungen. Die Kopfsummen sind als Werte der gefilterten Auswahl bezeichnet; die Zahlungsliste summiert die ausgewählten Einzelzahlungen.

| Bereich | Mobile Funktionen |
| --- | --- |
| Forderungsliste | Restschuld, ursprüngliche Forderung, bereits gezahlter Betrag und laufende monatliche Raten; Gläubiger, Stadium, Zweck und Aktenzeichen in den Zeilen. Große Bestände bleiben vollständig nachladbar. |
| Suche und Filter | Volltextsuche, aktueller Fall/alle geladenen Fälle, Fallauswahl, aktuelle/historische/alle Schulden, Stadium, Gläubiger, Zahlungsstand und Sortierung. Zahlungen zusätzlich nach Jahr und Handkassenbezug. Eine Suche nach einer Zahlungsnotiz liefert gezielt die passende Einzelzahlung. |
| Forderungsdetails | Sämtliche Kosten, Zahlungen, Restschuld, Ratenplan, Bankdaten, Kennungen, Notizen, Statusdaten und vorhandene Verknüpfungen. |
| Forderung erfassen/bearbeiten | Alle 19 ursprünglichen Eingaben: Gläubiger, Kategorie, Aktenzeichen, Forderungsbeginn, Hauptforderung, Mahnkosten, Bearbeitungskosten, Prozesskosten, bereits gezahlter Basisbetrag, Rate, Intervall, Stadium, Dauerauftrag, Kontoinhaber, IBAN, BIC, Bank, Verwendungszweck und Notizen. |
| Zahlungen | Datum, Betrag, Hinweis und Kennzeichnung als Barzahlung aus der Handkasse; Einzelzahlungen ansehen, erfassen, korrigieren und nach Bestätigung löschen. |
| Status und Hinweise | Pausieren, fortsetzen, erledigen und Statusänderung im Formular; zugehörige Datumsfelder und bestehende Warnungen bleiben erhalten, einschließlich noch aktiver Daueraufträge. |
| Fristen | Vorhandene Verknüpfung des errechneten Schuldenabbaus mit Fristen, Kalender und Aufgaben anlegen und entfernen. |
| Zahlungswerkzeuge | Vollständiger bisheriger Zahlungsdialog in der mobilen Formularansicht: Empfänger, Auftraggeber, Datum, Betrag, Zweck, Intervall, Monatstag, Enddatum sowie Dokumentations- und Handkassenoptionen. Giro-Code, SEPA-Datei und Banking-Übergabe bleiben verfügbar. |
| Geleistete Zahlung | Gesonderte Bestätigung; Zahlung und Finanzübernahmen werden gespeichert, anschließend läuft die vorhandene automatische Dokumentation. Währenddessen ist eine zweite Bestätigung gesperrt. |
| Gläubigerschreiben auswerten | Bestehende lokale Texterkennung und KI-Auswertung. Das Ergebnis erscheint als ungespeicherter, bearbeitbarer Forderungsentwurf. Bestätigen übernimmt auch erkannte Kosten, Bankdaten, Ratenplan und Zahlungen. |
| Mehrere Fälle | Übersicht der bereits geladenen Fälle. Fremde Fälle sind zunächst lesbar; Bearbeiten erfordert das bewusste Öffnen des betreffenden Falls über die vorhandene Funktion. Gleiche Forderungskennungen verschiedener Fälle bleiben getrennt. |

Das ursprüngliche Forderungsmodell und seine vier Stadien `offen`, `ratenzahlung`, `pausiert` und `erledigt` bleiben bestehen. Ebenso bleiben die sieben Ratenintervalle und die bisherige Berechnung des voraussichtlichen Schuldenabbaus erhalten. Die Auswertung besitzt im ursprünglichen Modul keinen eigenen Anhangspeicher; es wurde deshalb kein Belegknopf ohne hinterlegte Dokumentablage ergänzt.

Alle Änderungen laufen weiter durch die vorhandenen Finanzverknüpfungen:

- **Vermögensaufstellung:** ursprüngliche Forderung im Anfangsbestand, verbleibende Restschuld im Abschlussbestand.
- **Lebensunterhalt:** laufende Raten werden mit dem vorhandenen Intervallfaktor in monatliche Ausgaben übernommen. Pausieren beziehungsweise Erledigen entfernt die laufende Rate.
- **Handkasse:** nur entsprechend markierte Barzahlungen erzeugen eine verknüpfte Ausgabe. Korrektur oder Löschung aktualisiert genau diese Buchung.

Die Banking-Übergabe öffnet den vorhandenen Zahlungs- beziehungsweise Intervallentwurf mit den eingetragenen Daten. Die separate Aktion „Zahlung als geleistet erfassen“ verbucht eine bereits ausgeführte Zahlung. Schlägt danach die automatische Dokumentation fehl, bleibt die Zahlung gespeichert und der Fehler wird gemeldet.

## Gemeinsame Bedienung und Eingabeschutz

Beide Module verwenden dieselben mobilen Bausteine wie die Dokumentation: dunkelblaue Kopfzeile, flache Listen, vollständige Detailseiten, gegliederte Formulare, Filter- und Aktionsblätter sowie fest erreichbare Formularaktionen. Chats und Mitarbeiterchat-Badge bleiben Teil der gemeinsamen Navigation.

Die vereinbarte Navigationssteuerung bleibt erhalten: beim Abwärtsscrollen ausblenden, beim Aufwärtsscrollen sowie am Anfang und beim Ansichtswechsel einblenden; bei geöffneter Bildschirmtastatur ausblenden. Die Formularaktionen bleiben im verbleibenden Sichtbereich erreichbar.

Ungespeicherte Eingaben bleiben bei Neuzeichnen, Remote-Hinweisen, Chatwechsel und Größenwechsel erhalten. Verlassen mit Änderungen verwendet die gemeinsame Verwerfentscheidung. Speichern und Löschen prüfen Berechtigung, Fall, geladene Dateninstanz und zwischenzeitliche Änderungen. Ein älterer Entwurf überschreibt keine neuere Position oder Zahlung. Synchrone Speicherfehler stellen auch die betroffenen verknüpften Daten wieder her. Laufende Auswertungen bleiben an ihren ursprünglichen Fall gebunden.

Die Desktopansichten mit den ursprünglichen Tabellen, Filtern, Aktionen und Auswertungswegen bleiben verfügbar.

## Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| Lebensunterhalt im Browser | **39 bestanden**, einschließlich vollständiger Erfassung, Leistungsabgleich, Nullbeträgen, Dateiverarbeitung, selektiver Übernahme, Entwurfsschutz und Berichtsübergabe. |
| Schuldenregulierung im Browser | **54 bestanden**, einschließlich aller Eingabefelder, drei Finanzverknüpfungen, Statuswechsel, Fristen, tatsächlicher SEPA-Dateierzeugung, Giro-Code, Banking-Entwurf und lokalem PDF-Auslesen. |
| Verknüpfte Module erneut im Browser | **46 Vermögensaufstellung, 42 Handkasse und 64 Banking bestanden.** |
| Darstellung | Hell und dunkel bei 320, 360, 390 und 430 Pixeln; kein horizontaler Überlauf in den geprüften Listen. Filter, Details, Formulare, Auswertung und Zahlungswerkzeuge zusätzlich visuell geprüft. |
| Gezielte mobile Tests | **163 bestanden**, einschließlich 23 neuer Funktionstests für diese beiden Module und Syntaxprüfung aller 229 ausführbaren JavaScript-Blöcke. Nach der abschließenden Singular-/Plural-Korrektur beim Hinweisbutton wurden Schulden-Browserablauf sowie Schulden- und Syntaxprüfungen erneut erfolgreich ausgeführt. |
| Vollständige Suite | **1.317 Tests: 1.313 bestanden, 3 bereits bekannte Fehler, 1 übersprungen.** |
| Dateiintegrität | 311 Scriptblöcke erhalten; alle 82 eingebetteten Datenblöcke und das vorhandene NUL-Byte erhalten. Änderungen betreffen ausschließlich die zwei bestehenden Modul-Scriptblöcke und den mobilen CSS-Block. Alle übrigen Bytes entsprechen dem Arbeitsstand zu Beginn dieser Umsetzung. |

Die drei bekannten Suite-Fehler betreffen die Backup-/Recovery-Registrierung von `office_ai_config.allowed_models` und den V230-PDF-Golden-Vergleich. [Nachweis am ursprünglichen Ausgangsstand](mobile-fundament-v1/baseline-fehler.txt). Die testbedingt veränderte PDF-Golden-Datei wurde wiederhergestellt.

Die Browserprüfungen verwenden die tatsächliche App mit synthetischen Fällen und abgefangenen Netzwerkantworten. Bei Lebensunterhalt wird eine echte Textdatei durch die vorhandene Verarbeitung geführt; bei Schuldenregulierung wird ein synthetisches PDF mit den lokalen OCR-Komponenten ausgelesen. Die externe KI-Antwort, Serverantworten und automatische Dokumentationsspeicherung werden im Test vorgegeben. Echte Server-Fallwechsel, externe KI-/Bankdienste und eine physische iPhone-Tastatur sind damit nicht geprüft. Es wurden keine Produktivdaten geändert und keine echten Zahlungen eingereicht.

## Nachweise

- [Lebensunterhalt: Browserprüfung](mobile-lebensunterhalt-schuldenregulierung-v1/lebensunterhalt-browser.txt)
- [Schuldenregulierung: Browserprüfung](mobile-lebensunterhalt-schuldenregulierung-v1/schulden-browser.txt)
- [Vermögensaufstellung: Wiederholungsprüfung](mobile-lebensunterhalt-schuldenregulierung-v1/vermoegen-regression.txt)
- [Handkasse: Wiederholungsprüfung](mobile-lebensunterhalt-schuldenregulierung-v1/handkasse-regression.txt)
- [Banking: Wiederholungsprüfung](mobile-lebensunterhalt-schuldenregulierung-v1/banking-regression.txt)
- [Gezielte mobile Tests](mobile-lebensunterhalt-schuldenregulierung-v1/gezielte-tests.txt)
- [Abschließende Schulden- und Syntaxprüfungen](mobile-lebensunterhalt-schuldenregulierung-v1/abschluss-tests.txt)
- [Vollständige Suite](mobile-lebensunterhalt-schuldenregulierung-v1/vollstaendige-testsuite.txt)
- [Bytevergleich und SHA-256](mobile-lebensunterhalt-schuldenregulierung-v1/integritaet.json)
