# Produktives Adressbuch – Funktionsabgleich

Stand: 12.09.2026. Umsetzung in der ausgelieferten Anwendung und den bestehenden Serverdaten. Das HTML-Mockup ist keine Datenquelle und wird nicht als separate Anwendung eingebunden.

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

## Korrekturlauf vom 11.09.2026

Die anschließende Prüfung des neuen Adressbuchs hat folgende Fehler gezielt nachgestellt und behoben:

- Mobile Filter wurden durch ältere Layoutregeln auf Knopfbreite reduziert und unten abgeschnitten. Menüs nutzen jetzt die verfügbare Breite und Höhe innerhalb der sichtbaren Arbeitsfläche; außerhalb klicken oder Escape schließt sie.
- Im mobilen Bearbeitungsformular war „Fertig“ erst nach dem gesamten Formular erreichbar. Das Formular scrollt jetzt getrennt von seinen ständig sichtbaren Aktionen. Vorschlagslisten bleiben innerhalb der Formularfläche und verdecken diese Aktionen nicht. „Speichern erneut versuchen“ erscheint nur bei einem Speicherfehler.
- Leere Trefferlisten konnten in der mobilen Detailansicht festhängen. Sie führen zurück zur Liste und halten Suche, Filter und Statusanzeige verfügbar.
- Die Auswahl eines Ansprechpartners ging beim Neuaufbau der Liste verloren. Sie bleibt kontaktbezogen erhalten und wird auch beim Kopieren der Kontaktdaten berücksichtigt.
- Ein bereits gesetzter Standard ließ sich nicht direkt von der Institution auf einen Ansprechpartner umstellen. Der markierte Standard berücksichtigt jetzt die konkrete Person.
- Offene Ansprechpartner- und Zuordnungsformulare konnten durch Aktualisierungen ersetzt werden. Sie bleiben erhalten; unübernommene Eingaben sind beim Verlassen geschützt. Wiederholtes Auslösen während des Speicherns wird abgefangen.
- Verspätete Kontaktantworten konnten ein neueres Formular ersetzen. Sie werden beim Wechsel oder Schließen verworfen. Mobile Navigation wartet auf die Speicherung und lässt fehlerhafte Eingaben geöffnet.
- A–Z berücksichtigt auf niedrigen Mobilbildschirmen den tatsächlich scrollenden Listenbereich. Die Alphabetleiste bleibt einheitlich ausgerichtet. Kompakte Fenster erhalten mehr Platz für Kontakte; bei schmalen geteilten Ansichten bleibt der Detailbereich ausreichend breit.

`QA_REGRESSIONS=1 node server/scripts/qa-addressbook-modern.cjs` führt die ergänzenden Browserprüfungen aus (`QA_BROWSER=webkit` für Safari/WebKit; `PLAYWRIGHT_MODULE` kann auf die lokale Playwright-Installation zeigen). Der Lauf verwendet die echte ausgelieferte Anwendung, echte Kontaktrouten und ausschließlich eine temporäre Datenbank. Er prüft Desktop 1100 × 650 und 800 × 650 sowie Mobil 390 × 700 und 320 × 640, einschließlich Hell-/Dunkelansicht. Verzögerte Antworten werden vor dem echten HTTP-Aufruf angehalten und anschließend freigegeben.

Ergebnis: 25 ergänzende Browserprüfungen je Engine erfolgreich, dazu der vollständige Funktionstest in Chromium und WebKit sowie weiterhin 43 gezielte Tests. Sichtgeprüfte Beispiele der Korrektur: [mobile Filter](adressbuch-modern/korrekturen/mobil-filter.png), [mobiles Formular](adressbuch-modern/korrekturen/mobil-formular.png), [mobile Liste](adressbuch-modern/korrekturen/mobil-liste.png), [320 Pixel hell](adressbuch-modern/korrekturen/mobil-schmal-hell.png), [320 Pixel dunkel](adressbuch-modern/korrekturen/mobil-schmal-dunkel.png), [schmaler Desktop hell](adressbuch-modern/korrekturen/desktop-schmal-hell.png), [schmaler Desktop dunkel](adressbuch-modern/korrekturen/desktop-schmal-dunkel.png).


## Abschluss der Restarbeiten vom 12.09.2026

- Zusammenführen und Trennen sind online jeweils eine Datenbanktransaktion. Kontakte, zentrale Projektionen, Änderungsnachweise und Wiederherstellungsdaten werden gemeinsam gespeichert. Erst danach werden verbundene Fenster benachrichtigt. Ein Vorgang mit verlorener HTTP-Antwort kann mit seiner Vorgangs-ID wiederholt werden. Neuere Änderungen verhindern ein überschreibendes Trennen.
- Der Server verwahrt Originaldaten einschließlich Kontakt-IDs und Verbindungsmetadaten in `addressbook_merges`. Die Tabelle ist in der Modul- und Fallsicherung registriert. Altbestände ohne Serverarchiv werden ebenfalls atomar getrennt. Ein in einen anderen Fall importiertes Archiv darf den Ursprungsfall nicht verändern.
- Ansprechpartner haben einen eigenen versionsgesicherten Speicherweg. Änderungen verschiedener Personen erhalten sich auch über zentrale Fallprojektionen hinweg. Gleichzeitige Änderungen derselben Person werden ausdrücklich aufgelöst; unveränderte Felder des anderen Bearbeiters bleiben erhalten.
- Online speichern Ansprechpartner und neue Fallzuordnungen gültige Eingaben automatisch. Weitere Eingaben während eines laufenden Speicherns werden anschließend gespeichert. Eine stabile ID verhindert doppelte Personen oder Zuordnungen bei Wiederholungen. Fehler und ungültige Angaben bleiben im Formular; Navigation und Schließen warten auf eine erfolgreiche Speicherung. „Fertig“ schließt das Formular. Lokal wird weiterhin beim Übernehmen gespeichert.
- Die Suche berücksichtigt Namen, Abteilung, Funktion, E-Mail, Telefon und Fax der Ansprechpartner innerhalb einer Institution.
- Änderungsverlauf und Kommunikation besitzen eine Fortsetzung über „Weitere … laden“ (100 bzw. 200 Einträge pro Abruf). Zeitgleiche Einträge werden stabil sortiert; Fallrechte werden bei jedem Abruf geprüft. Historische Kontaktverknüpfungen bleiben auch über mehrfache Zusammenführungen und deren Rücknahme auffindbar.
- Große Kontaktlisten zeigen jeweils 200 Treffer. Suche, Filter, Alphabet, Gesamtauswahl und Export verwenden den vollständigen Trefferbestand. A–Z lädt die passende Seite. Ein gemeinsamer DOM-Aufbau reduziert die Zahl der Darstellungsänderungen.
- Über mehrere Merkmale verbundene Dublettengruppen werden vollständig vereinigt, sodass kein Kontakt doppelt in einer Zusammenführung vorkommt. Eine gemeinsame E-Mail allein reicht weiterhin nicht für einen Dublettenvorschlag.
- Echtzeit-Nachrichten entfernen gelöschte Dubletten samt Auswahl in anderen Fenstern und ergänzen wiederhergestellte Kontakte genau einmal. Erledigte Speicherfehler verschwinden auch aus den Hinweismeldungen.

### Nachweise

63 gezielte Server-, Integrations- und Oberflächentests erfolgreich, einschließlich des echten WebSocket-Prüflaufs.

`server/tests/addressbook-reliability.test.cjs` prüft unter anderem parallele Personenänderungen, idempotente Fallzuordnungen, Transaktionsabbruch in einer zweiten Merge-Gruppe, keine vorzeitigen Echtzeit-Nachrichten, verlorene Antworten, Versionskonflikte, Metadatenwiederherstellung, zentrale Projektionen, Altbestände, verschachtelte Zusammenführungen und lückenlose Fortsetzungen mit 305 Änderungen bzw. 505 Dokumentationen. `server/tests/addressbook-realtime.test.cjs` führt den tatsächlichen Empfangscode der ausgelieferten Anwendung mit Create-, Update- und Delete-Nachrichten aus.

`QA_EXTENDED=1 node server/scripts/qa-addressbook-modern.cjs` ergänzt die Browserprüfung um Autosave ohne Bestätigung, weiteres Tippen während des Speicherns, Abbruch und Wiederholung, Personen-Konfliktauflösung, automatische Fallzuordnung, Nachladen, verlorene Merge-/Undo-Antworten und 5.000 zusätzliche Kontakte. Die Browserläufe verwenden echte App-Datei, HTTP-Routen und SQLite-Daten, getrennt von den Benutzerdaten.

Die vollständigen Funktionsläufe, 25 Darstellungs-/Navigationsprüfungen und 15 erweiterte Prüfungen sind jeweils in Chromium und WebKit für Desktop und emulierte Mobilansicht erfolgreich. Die kleinen Ansichten umfassen 320 × 640, 390 × 700 und 800 × 650 Pixel. Beim letzten Chromium-Belastungslauf lagen der Aufbau bei 124–147 ms und die Suche bei 200–319 ms; in WebKit bei 49–55 ms und 46–75 ms. Dies sind lokale Messungen ohne CPU-Drosselung, keine Messungen auf einem physischen Smartphone. Sichtgeprüfte Beispiele: [Ansprechpartner mobil](adressbuch-modern/restarbeiten/ansprechpartner-mobil.png), [5.000 Kontakte mit Seitenauswahl](adressbuch-modern/restarbeiten/kontaktseiten-mobil.png).

Die laufende Demo unter `http://localhost:8935` wurde mit dem freigegebenen Vorführkonto geöffnet. Adressbuch, Kontaktinformationen und Übergabe an die Falldokumentation wurden geprüft: Der gewählte Kontakt sowie Bereich und Gegenüber waren passend vorausgewählt; Kontaktart, Themenfeld und Vorgang blieben frei. Der eigene ungespeicherte Testentwurf wurde verworfen. Der Demomodus hält Änderungen ausdrücklich nur in der Sitzung; die dauerhaften neuen Online-Speicherwege wurden deshalb mit der isolierten Serverdatenbank geprüft. Ein physisches Smartphone sowie Schreibvorgänge in verbundenen externen Konten waren nicht Teil dieser Prüfung.

## Fachliche Erweiterungen vom 12.09.2026

Die folgenden Ergänzungen sind im realen Adressbuch und seinen Speicherwegen umgesetzt:

| Funktion | Umsetzung |
| --- | --- |
| Kundennummer je Fall | Eigenes Feld im Kontakteditor, beim Zuordnen und unter „Fallangaben bearbeiten“. Aktenzeichen, Vorgangsnummer und Kundennummer bleiben unabhängig von zentralen Stammdaten. |
| Benannte Anschriften | Bis zu 30 zusätzliche Anschriften mit Bezeichnung, Postfach und Land; eine bevorzugte Anschrift für Dokumentempfänger und Kopieraktionen. Die bisherige Hauptanschrift bleibt erhalten. |
| Bevorzugter Kontaktweg | E-Mail, Telefon, Mobiltelefon, Post oder Fax für Institution und Ansprechpartner. Sichtbar in den Kontaktdaten. |
| Erreichbarkeit und Vertretung | Telefonzeiten, Abwesenheitsbeginn/-ende und Hinweise. Institutionen können einen zentralen Kontakt als Vertretung verknüpfen; Ansprechpartner eine andere Person derselben Institution. |
| Standardempfänger | Eigene Standards für Gericht, Arzt, Versicherung und jeden vorhandenen Schreibentyp, jeweils mit optionalem Ansprechpartner. Reihenfolge: Schreibentyp → Rolle → allgemeiner Dokumentstandard. Manuelle Empfänger und ausdrücklich für einen Export gewählte Adressen bleiben erhalten. Für das aktuelle Schreiben lässt sich eine Rolle festlegen. |
| Benannte Ansichten | Persönlich auf dem Server gespeicherte Filteransichten: anlegen, auswählen, umbenennen und löschen. Enthalten Suche, Sortierung, alle bisherigen Filter sowie „Ohne E-Mail“; Versionsprüfung schützt gleichzeitige Änderungen. |
| Änderungsverlauf | Neue Felder einschließlich Anschriften und Erreichbarkeit werden mit vorherigen/neuen Werten erfasst und können wiederhergestellt werden. Personen- und Anschriftenänderungen werden bei Zusammenführungen erhalten. |

### Gemeinsamer Kommunikationsverlauf

Der Verlauf führt verknüpfte Falldokumentation, empfangene und gesendete Postfachnachrichten, bestätigte Schreiben aus der Versandhistorie und verknüpfte Wiedervorlagen zusammen. „Rückmeldung vereinbaren“ erzeugt eine echte Wiedervorlage und einen verknüpften Dokumentationseintrag in einer Transaktion. Eine stabile Vorgangs-ID verhindert doppelte Anlagen bei wiederholten Anfragen. Die Wiedervorlage kann im bestehenden Modul weiterbearbeitet werden; ihr Ursprung führt zum Kontakt zurück.

Beim Öffnen von „Kommunikation“ und während dieser Ansicht werden erreichbare Postfächer automatisch abgeglichen. Die Oberfläche zeigt Fortschritt und Teilfehler. Alle Nachrichtenseiten werden abgefragt; Microsoft-Ordner werden für diesen Abgleich einschließlich Unterordnern und Folgeseiten geladen. Das normale Volltextsuch-Limit wird dafür nicht verwendet. Der lokale Nachrichtenindex enthält nur Umschlagdaten, keine Nachrichtentexte oder Anlagen, und ist aus den Postfächern wiederaufbaubar. Die Originalnachricht öffnet sich im bestehenden Mailmodul. Entwürfe gelten nicht als versendet.

Explizite Fall- und Kontaktverknüpfungen haben Vorrang. Ansonsten erfolgt die Zuordnung nur über eindeutige E-Mail-Adressen; dokumentierte frühere Adressen werden berücksichtigt. Mehrere Empfänger sind möglich, gemeinsam genutzte uneindeutige Adressen werden nicht geraten. Ältere bestätigte Briefe ohne Kontakt-ID können zusätzlich über einen exakt passenden eindeutigen Empfängernamen bzw. Adressblock zugeordnet werden. Die gleiche Nachricht wird anhand ihrer Message-ID zusammengeführt; bei dokumentiertem SMTP-Versand wird diese ID mitgespeichert. Private Postfächer und Wiedervorlagen bleiben auf ihre Eigentümer beschränkt, auch gegenüber einem Administrator. Fallrechte gelten bei jedem Abruf. Ein unbekannter oder mehrdeutiger Altbestand benötigt weiterhin eine ausdrückliche Verknüpfung.

### Speicherung, Austausch und Prüfung

Online bleibt Autosave die Standardspeicherung. Persönliche Ansichten werden in `addressbook_views` gespeichert und sind in der Büro-/Modulsicherung enthalten. Der Nachrichtenindex ist als wiederaufbaubarer Cache registriert. Die Tabellen werden beim Serverstart ohne Ersetzen bestehender Kontaktdaten angelegt.

Die Excel-Fallliste erhält zusätzliche beschriftete Spalten ab AK für Kundennummer, Anschriften, bevorzugte Wege, Erreichbarkeit, Vertretung, Ansprechpartner, Standards und zentrale Zuordnung. Strukturierte Angaben werden verlustfrei als JSON-Zellwerte ausgetauscht. Der Rückimport liest diese Spalten; ältere Vorlagen ohne die Zusatzspalten bleiben kompatibel. Jede Fallliste enthält weiterhin vollständige Kontaktprojektionen mit ihren eigenen Referenzen.

Geprüft mit temporärer SQLite-Datenbank und der tatsächlichen ausgelieferten Anwendung: 90 gezielte Tests einschließlich Echtzeit, Falldokumentation, Sicherungen, bestehender Mail-/Wiedervorlagenfunktionen und neuer Datenfelder. Die neuen Browserabläufe prüfen Autosave, Falltrennung, bevorzugte Anschriften, Vertretung, Standardvorrang, persönliche Ansichten, Rückmeldungen sowie einen echten Excel-Export mit anschließendem Rückimport. Chromium und WebKit decken Desktop und emulierte Mobilansicht einschließlich 320 Pixel Breite und Hell-/Dunkelmodus ab. Zusätzlich bestehen die 25 bisherigen Darstellungs-/Navigationsprüfungen und der Chromium-Belastungslauf mit 5.000 Kontakten, Nachladen und wiederholten Merge-Anfragen.

Der Postfachabgleich wurde mit simulierten Providerantworten (einschließlich mehrerer Seiten und privater Konten) geprüft; es wurden keine externen Testnachrichten versendet. Eine Prüfung mit realen IMAP-/Microsoft-Postfächern ist damit nicht ersetzt.

Reproduzierbarer neuer Browserlauf: `QA_EXPANSION=1 node server/scripts/qa-addressbook-modern.cjs`, für Safari zusätzlich `QA_BROWSER=webkit`. Bildschirmbeispiele: [Desktop](adressbuch-modern/erweiterungen/desktop.png), [Mobil](adressbuch-modern/erweiterungen/mobil.png).
