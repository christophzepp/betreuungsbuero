# Erneute Bugprüfung der mobilen Ansichten

Stand: 8. September 2026. Die 32 freigeschalteten Hauptmenüs wurden erneut anhand der bestehenden Browserpakete und zusätzlicher Fehlerfälle geprüft. Weitere Fehler sind im lokalen Arbeitsstand korrigiert. Zusätzlich zu Chromium kam diesmal WebKit zum Einsatz.

## Gefundene und behobene Fehler

| Bereich | Reproduzierbarer Auslöser und bisheriger Fehler | Korrektur |
|---|---|---|
| Betreuungsübersicht | Formular öffnen, zu einem anderen Menü wechseln und zurückkehren: Das Menü ließ sich anschließend nicht mehr öffnen. Betroffen waren unveränderte und ausdrücklich verworfene Entwürfe. | Ein bereits freigegebener Formularschutz blockiert den nächsten Aufruf nicht mehr. |
| Kontaktmonitor | Derselbe Menüwechsel aus der Turnusbearbeitung konnte auch den Kontaktmonitor blockieren. | Freigegebene Formularzustände werden beim Wiederöffnen korrekt unterschieden. Aktive Entwürfe bleiben geschützt. |
| Status- und Jahresfilter | Der eigene Bearbeitungsstand im Posteingang bzw. der zusätzliche Jahresfilter wurden bereits beim Auswählen wirksam, obwohl „Anwenden“ noch nicht gedrückt war. | Diese Filter verwenden einen Entwurf. Schließen bzw. Escape verwirft ihn; Anwenden übernimmt ihn. Der Jahresablauf wurde zusätzlich im Archiv geprüft. |
| Posteingang | Nach Anwenden des Statusfilters zeigte der Bereichsreiter weiterhin die vorige Auswahl. | Filterwert, sichtbare Liste und aktiver Reiter werden gemeinsam aktualisiert. |
| Fähigkeiten & Alltag | Eine Suche nach einem sichtbaren Vorschautext, etwa „Rezeptkarten“, lieferte keinen Treffer. | Die gemeinsame Listensuche berücksichtigt auch den sichtbaren Inhaltstext. |
| Auswahlfelder in WebKit | Native Auswahlfelder wurden trotz CSS-Mindesthöhe nur 23 Pixel hoch gerendert. | Touchgerechte Darstellung mit eigener Pfeilgrafik; das echte Auswahlfeld und seine Auswahlfunktion bleiben erhalten. Mehrfachauswahl und mehrzeilige Listen sind ausgenommen. |
| Erneut geöffnete Blätter in WebKit | In längeren Abläufen konnten gezeichnete Filterfelder intern weiterhin als unsichtbar gelten und waren dadurch nicht zuverlässig bedienbar. | Das geöffnete Blatt erhält einen ausdrücklichen Sichtbarkeitszustand. Geschlossene Blätter sind zusätzlich inaktiv; verzögerte Fokusaufrufe berücksichtigen nur das aktuell geöffnete Blatt. |

Die Fachmodelle und Speicherwege werden weiterverwendet. Die bestehenden Regeln für Scrollnavigation, Tastatur, Chats und Entwurfserhalt bleiben Bestandteil der Prüfungen.

## Ergebnisse

- **204 mobile Codeprüfungen bestanden**, keine fehlgeschlagen.
- **Alle 17 Chromium-Browserpakete bestanden**: Fundament, Navigation, Aufgaben, erstes Modulpaket, Kalender, E-Mail, Explorer, Banking, Rechnungslegung, Handkasse, Vermögen, Lebensunterhalt, Schulden, Finanzen, Rechnungen, Fahrtkosten und Abschlussmodule.
- **Zehn neue Regressionstests jeweils in Chromium und WebKit bestanden**: vier Varianten des Formular-/Menüwechsels, Filter abbrechen, Filter anwenden, Inhaltssuche, Jahresfilter, Touchflächen und wiederholte Blattwechsel.
- **143 Prüfungen der Abschlussmodule zusätzlich in WebKit bestanden**, ohne JavaScript-Laufzeitfehler.
- **41 ergänzende Prüfungen bestanden**, darunter Start, Stammdaten, Benutzermenü, Darstellungseinstellungen, Chats-Zugang, Bereichsreiter und Schnellnotiz.

Die Prüfungen umfassen 320, 390 und 430 Pixel breite Ansichten, Hell/Dunkel, Formularaktionen, Speichern/Abbrechen, Chat-Rückkehr, Tastatur-/Scrollnavigation und Desktop-Rückwege in den jeweiligen Browserpaketen. Alle Browserläufe verwenden synthetische Daten und abgefangene APIs. WebKit wurde automatisiert auf dem Mac geprüft; ein physischer iPhone-Test ist darin nicht enthalten.

[Gesamtergebnisse](mobile-bugpruefung-v2/pruefergebnisse.json) · [Codeprüfungen](mobile-bugpruefung-v2/logs/code-tests.log) · [Chromium-Pakete](mobile-bugpruefung-v2/browser/results.json) · [WebKit-Protokoll](mobile-bugpruefung-v2/logs/webkit-completion.log)

## Abgedeckte Hauptmenüs

Start, KI-Fallchat, Stammdaten, Fallübersicht, Falldokumentation, Kalender, Aufgaben, Fristen, Wiedervorlagen, Adressbuch, E-Mail, Datei-Explorer, Archivierte Formulare, Export- und Versandhistorie, Banking, Handkasse, Vermögensaufstellung, Lebensunterhalt, Schuldenregulierung, Gesundheit, Wohnen, Fähigkeiten & Alltag, Wünsche und Bedarfe, Genehmigungen, Kontaktmonitor, Betreuungsübersicht, Posteingang, Finanzen, Ausgangsrechnungen, Fahrtkosten, Qualifikationsmanager, Benutzermenü.

Rechnungslegung sowie Büroarchiv und Büroversand sind zusätzlich über ihre fachlichen Zugänge mitgeprüft.

## Änderungsnachweis

Die App-Datei wurde in drei gezielten Skriptblöcken und einem Stilblock geändert. Die **82 typisierten eingebetteten Datenblöcke sind bytegleich**. Die 229 ausführbaren JavaScript-Blöcke lassen sich ohne Syntaxfehler parsen; die Gesamtzahl von 311 Skriptblöcken bleibt unverändert. Auch außerhalb der geänderten Blockinhalte ist die Datei bytegleich zur Ausgangsfassung dieses Prüflaufs.

[Gezielter Diff](mobile-bugpruefung-v2/aenderungen.diff) · [Quellstand und Prüfsummen](mobile-bugpruefung-v2/quellstand.json)

Die dauerhaften neuen Browserfälle liegen in `server/scripts/qa-mobile-bugcheck.cjs`. `qa-mobile-completion.cjs` unterstützt nun die Browserwahl mit `MOBILE_QA_BROWSER=webkit` und protokolliert bei Fehlern zusätzlich Sichtbarkeitsdaten. Der Sammellauf `qa-mobile-visual-all.cjs` umfasst jetzt auch die Abschlussmodule und akzeptiert ein eigenes Ausgabeverzeichnis.

[WebKit: Filter hell](mobile-bugpruefung-v2/webkit-regression/auswahlfelder-touchgroesse-hell.png) · [Filter dunkel](mobile-bugpruefung-v2/webkit-regression/auswahlfelder-touchgroesse-dunkel.png) · [Wieder geöffnetes Filterblatt](mobile-bugpruefung-v2/webkit-regression/filterblaetter-wiederholen-bedienbar.png)

Die Korrekturen liegen lokal vor.
