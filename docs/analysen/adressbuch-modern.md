# Produktives Adressbuch – Funktionsabgleich

Stand: 11.09.2026. Umsetzung in der ausgelieferten Anwendung und den bestehenden Serverdaten. Das HTML-Mockup ist keine Datenquelle und wird nicht als separate Anwendung eingebunden.

## Bestehende Funktionen

| Bisherige Funktion | Zugang in der neuen Oberfläche | Prüfung |
| --- | --- | --- |
| Aktueller Fall, fremder Fall, alle Kontakte, Bürokontakte | Adressbuchauswahl oben | Browser: richtige Quelle bei Büro- und fremden Fallkontakten |
| Suche nach Name, Institution, Rolle, Ort und Aktenzeichen | Suchfeld | Bestehender Suchalgorithmus; Browserfilter |
| Status, Rolle, Ort, Institution, Kontaktart | Filter & Sortierung; zusätzliche Statustabs | Originalfelder und ursprüngliche Filterlogik erhalten |
| Sortierfeld, Richtung, Namensdarstellung | Filter & Sortierung | Originalfelder und ursprüngliche Sortierlogik erhalten |
| Filter zurücksetzen; A–Z-Sprung | Filtermenü und Alphabetleiste | Bestehende Funktionen; Sprung auf die neue Scrollfläche angepasst |
| Mehrfachauswahl und Auswahl aufheben | Über der Kontaktliste | Browser; Auswahl bleibt bei Speicherfehler erhalten |
| Einzel- und Sammelstatus aktiv/beendet | Kontaktaktionen bzw. Auswahlleiste | Browser mit erfolgreicher und fehlgeschlagener Speicherung |
| Neuer Kontakt, bearbeiten, löschen | Kopfzeile, Detailkopf, weitere Kontaktaktionen | Browser online und lokal; ID-lose Importe berücksichtigt |
| Kategorie und sämtliche vorhandenen Kontaktdaten | Bearbeitungsformular | Feldabgleich im Browser; inklusive Bankdaten, Postfach, getrennten Telefon-/Faxbestandteilen und Referenzen |
| Rollen-, Status-, Anrede-, Titel- und Adressvorschläge | Bestehende Vorschlagsfelder im Formular | An bestehende Wertelisten angebunden; freie Statuswerte bleiben möglich |
| Excel-Sicherung/Austausch | Importieren & exportieren | Originalexporter mit vollständigen Fallkontaktprojektionen; zusätzliche Prüfung des erzeugten XLSX |
| vCard-Import und Export, auch ausgewählter Kontakte | Importieren & exportieren | Echter Dateiimport/-download im Browser, Dublettenprüfung und Serverpersistenz |
| Online-Importablage und Export in verbundene Konten | Importieren & exportieren in Büro-/Gesamtansicht | Ursprüngliche Dialoge und Handler erhalten; Menüzugang geprüft |
| Duplikate finden, zusammenführen, wieder trennen | Importieren & exportieren → Duplikate & Kontakte zusammenführen | Ursprünglicher Dialog; Zusammenführung und Wiederherstellung mit Original-IDs geprüft |
| Dokumentempfänger setzen | Detailbereich; mit Ansprechpartnerauswahl | Tatsächliche Empfängerzeilen, HTML-Ausgabe und E-Mail-Adresse geprüft |
| E-Mail intern/extern, Telefon und Kartenadresse | Detailbereich | Ursprüngliches Mailmodul bzw. Links; keine Testnachrichten an externe Empfänger versandt |
| Daten und Faxnummer kopieren | Weitere Kontaktaktionen; Kopierschaltflächen neben Feldern | An echte Zwischenablage angebunden |

## Ergänzungen aus dem Mockup

- Geteilte Liste und Details, mit Maus und Tastatur verstellbare Breite. Die Einstellung wird gerätebezogen gespeichert. Mobile Ansicht mit Rückweg zur Kontaktliste, eigenem Scrollbereich und vollständigen Detailaktionen.
- Online-Autosave mit sichtbarem Status. Eingaben bleiben bei Verbindungsfehlern erhalten; Schließen wartet auf das Speichern. Bei parallelen Änderungen werden aktuelle und eigene Werte vor der Übernahme gegenübergestellt.
- Zentrale Stammdaten mit expliziten Fallzuordnungen. Jeder Fall erhält eine vollständige `case_contacts`-Projektion. Rolle, Aktenzeichen, Vorgangsnummer, Status und Notiz bleiben fallspezifisch. Änderungen gemeinsamer Felder werden transaktional in die zugeordneten Fälle übernommen.
- Mehrere Ansprechpartner je Institution, nutzbar für Dokumente, E-Mail und Falldokumentation. Ihre Auswahl ändert die sichtbaren persönlichen Kontaktdaten und bewahrt die Institution als stabile Kontaktreferenz.
- Je Fall und Zweck ein Standardempfänger für Dokumente bzw. neue E-Mails; optional ein bestimmter Ansprechpartner. Eine ausdrücklich getroffene Dokument- oder E-Mail-Empfängerauswahl hat Vorrang.
- Änderungsverlauf mit Zeitpunkt, Bearbeiter und vorherigen/neuen Werten. Datenänderungen lassen sich als neue protokollierte Änderung zurücknehmen. Zuordnungen und Standardempfänger werden in ihrem eigenen Bereich angepasst.
- Kommunikation zeigt tatsächlich verknüpfte Einträge aus der Falldokumentation. Neue Dokumentation kann direkt am Kontakt angelegt werden. Beim dokumentierten Mailversand bleibt eine explizite Kontaktwahl erhalten; sonst wird nur bei eindeutiger Empfängerübereinstimmung verknüpft. Bestehende Einträge ohne Kontaktverknüpfung werden nicht nachträglich geraten.

## Speicher und Kompatibilität

Die Online-Daten liegen weiterhin in SQLite, nicht in einem zusätzlichen Browser-Kontaktspeicher. Excel ist eine zusätzliche Sicherungs- und Austauschfunktion. Zentrale Zuordnungen verwenden vollständige Fallprojektionen, damit vorhandene Dokument-, Mail- und Excel-Wege ihre bisherigen Daten weiter erhalten.

Der vollständige Änderungsnachweis ist wie das Audit-Protokoll Bestandteil der SQLite-Vollsicherung. Ein portables JSON-Teilabbild ersetzt ihn nicht. Der Verknüpfungsindex kann aus `centralContactId` der gesicherten Kontaktprojektionen wieder aufgebaut werden. Fallrechte gelten auch für Zuordnungen und verknüpfte Dokumentation; gemeinsame Stammdaten erfordern Bearbeitungsrechte für alle betroffenen Fälle.

Ein zentraler Kontakt mit bestehenden Zuordnungen wird vor dem Löschen erst gelöst. Beim Zusammenführen verschiedener zentraler Kontakte müssen deren Zuordnungen ausdrücklich gelöst werden; eine normale lokale Dublette kann mit dem zentralen Kontakt zusammengeführt werden. Die ursprünglichen Import-/Exportdialoge für externe Anbieter bleiben erhalten. Die Tests senden keine E-Mails und verändern keine verbundenen Konten.

## Nachprüfbarer Aufbau

- `server/frontend/addressbook-modern.js` und `.css`: produktive Oberfläche.
- `server/scripts/build-addressbook-modern.cjs`: reproduzierbare Einbettung in die ausgelieferte HTML-Datei, ohne zusätzliche Skriptblöcke.
- `server/src/modules/contacts/addressbook*.js`: Serverfunktionen, Autosave, Zuordnungen, Standards, Verlauf und Kommunikation.
- `server/tests/addressbook-modern.test.cjs`: Datenkonsistenz, Konflikte, Berechtigungen und Wiederaufbau von Zuordnungen.
- `server/scripts/qa-addressbook-modern.cjs`: echte Anwendung und echte HTTP-Routen mit ausschließlich temporärer Testdatenbank; Desktop und Mobilansicht, Dateiimport/-export und gezielt ausgelöste Speicherfehler.

Zusätzlich geprüft werden die vorhandenen Tests für Falldokumentations-Verknüpfungen, persönliche Kontaktvorbelegung, Adressbuch-/Mail-/Dokument-Dunkelmodus, mobile E-Mail-Funktionen und portable Sicherungen.

## Ergebnis der Abschlussprüfung

43 gezielte Tests erfolgreich. Der vollständige Browserlauf mit temporärer Datenbank ist in Chromium und WebKit jeweils für Desktop (1440 × 1000) und Mobilansicht (390 × 844) erfolgreich. Ein zusätzlicher WebKit-Darstellungslauf prüft Auswahlfeldhöhen und 320 Pixel Bildschirmbreite. Geprüfte Bildschirmansichten: [Desktop hell](adressbuch-modern/desktop-light.png), [Desktop dunkel](adressbuch-modern/desktop-dark.png), [Mobil hell](adressbuch-modern/mobile-light.png), [Mobil dunkel](adressbuch-modern/mobile-dark.png).

Die lokalen Kommunikationstests sichern zusätzlich ab, dass importierte Kontakte ohne ID keine unverknüpften oder fremden Dokumentationen zugewiesen bekommen. Die Safari-Darstellung verwendet durchgehend ausreichend hohe Auswahlfelder.
