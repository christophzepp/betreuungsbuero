# Mobile Rechnungslegung und Handkasse

Stand: 07.09.2026. Umsetzung auf dem bestehenden Arbeitsstand des mobilen Umbaus, Release-Basis v0.7.7. Zuerst Rechnungslegung, anschließend Handkasse. Die Änderungen liegen lokal in `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html`.

[Galerie mit 22 tatsächlichen App-Ansichten](mobile-rechnungslegung-handkasse-v1/ansichten.html)

## Rechnungslegung

Der Einstieg bleibt **Fallübersicht → Schnellaktionen → Rechnungslegung**. Der vorhandene Berichtseditor erhält eine eigene mobile Darstellung; die Liste der 32 mobilen Hauptmodule wird dafür nicht erweitert.

| Arbeitsschritt | Mobile Funktionen |
| --- | --- |
| Zeitraum und Konten | Zeitraum bearbeiten; Kontenliste, Details, Bearbeiten und Neuanlage; Bank, Inhaber, IBAN, BIC und Salden; Übernahme aus Stammdaten und Banking; Vermögen, Verbindlichkeiten und Schenkungen mit allen vorhandenen Feldern und Aktionen. |
| Bankdaten importieren | PDF-, CSV-, XLSX- und XLSM-Dateiauswahl; Quellen, Erkennungszustand und Hinweise; erneutes Einlesen bzw. vorhandene KI/OCR-Aktionen; Banking-Übernahme mit Zeitraum, Vorschau und Dublettenprüfung. |
| Buchungen prüfen | Volltextsuche; Filter nach Konto, unsicheren Beteiligten und fehlenden Belegen; Details mit Datum, Wertstellung, Art, Beteiligtem, vollständigem Zweck, Betrag, Saldo und Quelle; Bearbeiten, Neuanlage im gewählten Konto und Entfernen. Alle Treffer können nachgeladen werden, auch oberhalb der ursprünglichen 500er-Anzeigegrenze. |
| Rechnungen und Belege | Dateiimport, Auswahl und Sammelaktionen; eigene Suche und Filter; Details, ursprüngliche sieben Metadatenfelder, Öffnen verfügbarer Originale, lokale Erkennung und konfigurierte KI-Funktionen; Entfernen. |
| Zuordnung und Nummern | Vorhandene Einzel- und Teilbetragszuordnung; Umfang und Zuordnungsregel; lokale und KI-gestützte Sammelzuordnung; Nummernvergabe. Einzelzuordnungen werden ausdrücklich gespeichert. |
| Prüfung und Ausgabe | Gesamtabgleich, gruppierte Hinweise, lokale und KI-Prüfung, gespeicherter Prüfchat; vollständiger vorhandener Exportdialog mit Ausgabearten, Empfängerwahl, Dokumentdaten, Anlagen, Signaturen und Vorschau. |

Berichtskopf, Berichtswerkzeuge und Archivfassungen sind über das Aktionsmenü erreichbar. Fachliche Import-, Salden-, Zuordnungs- und PDF-Funktionen bleiben bestehen. Die zugrunde liegenden Formulare werden mit ihren tatsächlichen DOM-Knoten übernommen; Setter laufen für geänderte Felder erst bei Speichern. Dadurch setzt etwa eine reine Änderung des Kontonamens keinen manuellen Endsaldo.

Die Vermögens-, Verbindlichkeiten- und Schenkungstabellen sowie der Berichtskopf behalten ihr vorhandenes Speichern bei Feldwechsel; die Oberfläche kennzeichnet dieses Verhalten. Originaldateien sind wie bisher nur in der Sitzung verfügbar und müssen nach erneutem Laden für OCR/Stempelung wieder ausgewählt werden. Erkannte Daten und Zuordnungen bleiben gespeichert.

## Handkasse

| Bereich | Mobile Funktionen |
| --- | --- |
| Kassenbuch | Gesamtbestand, Bewegung der Auswahl, Einnahmen/Ausgaben/Alle, vollständige Buchungsangaben in der Liste und nachladbare Treffer. |
| Suche und Filter | Empfänger, Zweck, Kategorie, Betrag, Datum und Herkunft; Jahr, Buchungsart, Kategorie, Einzel-/Serienzahlungen, Schuldenregulierung und Sortierung. |
| Details | Datum, Art, Betrag, Empfänger, vollständiger Zweck, Kategorie, laufender Saldo, Herkunft, Intervall, Serienfortschreibung und Verweis auf vorhandene Serienvorlage. |
| Eingabe | Neuanlage und Bearbeiten aller vorhandenen Buchungsfelder. Das komplette Ergebnis wird erst nach Speichern übernommen und anschließend über die bestehende AutoDoku-Schnittstelle dokumentiert. |
| Serien | Einmalig, wöchentlich, 14-tägig, monatlich, quartalsweise und jährlich; bestehende Fortschreibung bis heute; erzeugte Folgebuchungen behalten ihre Serienkennung. Beim Beenden einer Vorlage bleiben bestehende Buchungen erhalten. |
| Schreibschutz und Löschen | Spiegelungen aus der Schuldenregulierung bleiben schreibgeschützt. Andere Buchungen können nach ausdrücklicher Bestätigung gelöscht werden. Leseberechtigte behalten lesbare Details ohne Schreibaktionen. |
| Fall und Ausgabe | Bestehender Fallwechsel mit Rückkehr zum Ursprungsfall; vollständige PDF-/Excel-Ausgabe und Übergabe an dasselbe Handkassenkonto in der Rechnungslegung. Wiederholte Übernahmen aktualisieren dessen Buchungen. |

Der laufende Saldo wird **vor** allen Anzeige-Filtern aus dem vollständigen Kassenbuch berechnet. Der Vorjahresübertrag bleibt damit auch bei einem Jahresfilter korrekt. Exporte und Rechnungslegungsübernahme enthalten wie bisher sämtliche Jahre; das Aktionsmenü weist den Umfang ausdrücklich aus.

Die mobile Handkasse verwendet das vorhandene Buchungsmodell. Die beispielhaften Mockup-Angaben „Beleg“, „Belegnummer“ und „Gegenkonto“ besitzen darin bislang keine eigenen Datenfelder oder Speicherfunktion; sie wurden nicht als funktionslose Eingaben eingebaut. Die bestehenden Belegfunktionen der Rechnungslegung sind vollständig erreichbar.

## Gemeinsames Verhalten und Eingabeschutz

Beide Ansichten verwenden die mobile Kopfzeile, feste Formularaktionen, Filterblätter und den bestehenden Chats-Zugang. Abwärtsscrollen blendet die Navigation aus; Aufwärtsscrollen zeigt sie wieder. Bei geöffneter Tastatur wird die Navigation ausgeblendet und die Aktionsleiste bleibt oberhalb der Tastatur. Beide Module wurden in Hell und Dunkel bei 320, 360, 390 und 430 Pixeln geprüft.

Offene Entwürfe bleiben bei Aktualisierung, Chatwechsel und Größenwechsel erhalten. Verlassen mit Änderungen benötigt eine Verwerfentscheidung. Die Rechnungslegung prüft vor Speichern den ursprünglichen Datenstand; die Handkasse prüft Fall und Datensatz. Zwischenzeitlich geänderte oder gelöschte Buchungen werden nicht mit alten Entwürfen überschrieben. Bestehende Speicher- und Synchronisierungsschnittstellen bleiben unverändert.

Die Rechnungslegung arbeitet im Berichtseditor außerhalb des üblichen Modals. Deshalb erkennt der gemeinsame Formularschutz nun auch sichtbare Formulare im Arbeitsbereich; Rechnungslegungsdialoge werden als eigene mobile Ansicht erkannt. Das verhindert die überlagerte allgemeine Schließen-Leiste. Der Desktop erhält beim Zurückwechseln wieder seine ursprünglichen Tabellen und Werkzeuge; ein noch offener Entwurf bleibt zunächst erhalten.

## Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| Rechnungslegung im Browser | **49 erfolgreich**, einschließlich echtem CSV-Import, erneuter Originaldatei-Zuordnung, Banking-Vorschau und bestätigter Übernahme, Belegzuordnung und tatsächlicher PDF-Erzeugung. |
| Handkasse im Browser | **42 erfolgreich**, einschließlich tatsächlicher PDF-/XLSX-Dateien, Serien, AutoDoku, Fallrückkehr und wiederholter Rechnungslegungsübernahme. Die XLSX wurde zusätzlich auf ZIP-Struktur, Vorjahresbuchung und Saldenformeln geprüft. |
| Gemeinsame Oberfläche / Chats | **28 erfolgreich**. |
| Gemeinsame Navigation | **23 erfolgreich**. |
| Gezielte Tests | **185 bestanden**, darunter 15 neue Tests für Speichervorgänge, Konflikte, Berechtigungen, Filter und Salden. |
| Vollständige Suite | **1.282 Tests: 1.278 bestanden, 3 bereits bekannte Fehler, 1 übersprungen**. |
| Abschließende Prüfung | 15 neue Funktionstests und Syntaxprüfung aller 229 JavaScript-Blöcke bestanden. Nach der letzten Layoutkorrektur wurden beide Modul-Browserläufe erneut erfolgreich ausgeführt. |
| Dateiintegrität | 311 Scriptblöcke erhalten; alle 76 eingebetteten PDF-Blöcke und 6 JSON-Blöcke bytegleich; ein vorhandenes NUL-Byte erhalten. Änderungen betreffen vier bestehende ausführbare Scriptblöcke und den vorhandenen mobilen CSS-Block. |

Die drei Fehler der Gesamtsuite betreffen unverändert die Backup-/Recovery-Registrierung von `office_ai_config.allowed_models` und den V230-PDF-Golden-Vergleich. [Nachweis am unveränderten Ausgangsstand](mobile-fundament-v1/baseline-fehler.txt). Die durch den Test neu erzeugte Golden-Datei wurde nach Abschluss auf ihren ursprünglichen Stand zurückgesetzt.

Alle Browserprüfungen verwenden die ausgelieferte App mit synthetischen Fällen und abgefangenen Netzwerkantworten. Es wurden keine Produktivdaten geändert, keine Nachrichten versendet und keine Bankabrufe ausgelöst. Echte externe KI-Dienste und das Verhalten einer physischen iPhone-Tastatur sind durch diese Chromium-Prüfungen nicht nachgewiesen.

## Dateien und Nachweise

- [Rechnungslegung: Browserprüfung](mobile-rechnungslegung-handkasse-v1/rechnungslegung-browser.txt)
- [Handkasse: Browserprüfung](mobile-rechnungslegung-handkasse-v1/handkasse-browser.txt)
- [Gezielte Tests](mobile-rechnungslegung-handkasse-v1/gezielte-tests.txt)
- [Gesamtsuite](mobile-rechnungslegung-handkasse-v1/vollstaendige-testsuite.txt)
- [Gemeinsame Oberfläche](mobile-rechnungslegung-handkasse-v1/fundament-regression.txt)
- [Navigation](mobile-rechnungslegung-handkasse-v1/navigation-regression.txt)
- [Abschließende Prüfung](mobile-rechnungslegung-handkasse-v1/abschliessende-pruefung.txt)
- [Bytevergleich und SHA-256](mobile-rechnungslegung-handkasse-v1/integritaet.json)
