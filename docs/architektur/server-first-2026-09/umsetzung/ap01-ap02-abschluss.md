# AP-01 und AP-02: technischer Abschluss

Stand: 27.09.2026. Der Abschluss bezieht sich auf die ursprünglichen Basispakete aus Kapitel 04. Er ersetzt weder G0 noch die spätere Produktfreigabe. Die lokale technische Abnahme ist bestanden; die freigegebene Linux-CI läuft auf dem separaten Prüfzweig.

## AP-01: Referenz- und Regressionstestbasis

- Vier reproduzierbare synthetische Profile: kleiner Fall, 500 historische Ausgaben/100 Diagnosen, historischer Fall mit unbekannten Schlüsseln und Sonderwerten sowie konkurrierende Teiländerungen.
- Eigentümer, Leser, fremder Nutzer, fehlende Sitzung, entzogenes Schreib-/Dokumentrecht und Lokalmodus sind geprüft. Es werden echte temporäre SQLite-Dateien und die bestehenden Routen verwendet.
- Ein tatsächlicher SQLite-Abbruch muss HTTP 500 auslösen und den letzten bestätigten Datenstand bewahren. Eine getrennte Mutation lässt absichtlich den SQL-Schreibvorgang weg; die ansonsten erfolgreiche HTTP-Antwort muss an den gespeicherten Daten scheitern.
- Neuladen wird sowohl durch einen unabhängigen SQLite-Prozess als auch durch den vollständigen Browser geprüft. Alle bisherigen Source-Slice-Tests bleiben erhalten.
- Der Browser meldet sich über das echte Formular an, öffnet Stammdaten, liest den Fall/Bericht, erzeugt das Referenz-PDF und prüft nach dem Restore eine Eingabe über das Gesundheitsformular samt vollständigem Neuladen und unabhängiger SQLite-Kontrolle.
- Der CI-Workflow verlangt unter Node 22 und 24 frische Abhängigkeiten, die gesamte Suite, Browser-/Restoreprobe und den erwarteten roten Schreibverlusttest. Unvollständige, übersprungene oder abgebrochene Prüfläufe können nicht grün werden.

Der [maschinenlesbare Referenz- und Fehlerkatalog](ap01-ap02-referenzkatalog.json) verbindet Sollwerte, Rechte, Prüfwege und bekannte Abweichungen. Das [PDF-Sollartefakt](../../../../server/tests/fixtures/server-first/reference-report.pdf) wurde mit Poppler gerendert und visuell kontrolliert: Fallname, Kennung, Einnahmen und Ausgaben sind vollständig lesbar. Die Browserprüfung vergleicht die neu erzeugten Bytes mit diesem festen Sollstand und miteinander. Der Zeitstempel ist hierfür festgelegt; die Produktionsuhr wird nicht verändert.

## AP-02: vollständige synthetische Ausgangswiederherstellung

Der [bestehende Ausgangsablauf](restore-ausgangsnachweis.md) ist um Browserbedienung und neu erzeugte PDF-Ausgabe ergänzt. Die komplette Kette umfasst:

1. Büro mit Fall, Bericht, zwei echten Anmeldekonten, Leserecht, verschlüsseltem künstlichem Providerwert und getrennt verwahrtem Recovery-Schlüssel aufbauen.
2. Anwendung starten, im Browser anmelden, Referenzwerte laden/neu laden und Fach-PDF erzeugen.
3. Neun Dokumentdateien einschließlich Sicherheits-/Zugangsabbildern materialisieren und mit der tatsächlichen Backup-CLI sichern. HTML, Vorlagen und Manifest gehören zum Snapshot; aktive Schlüssel/.env nicht.
4. Dry-run und beschädigten Snapshot prüfen; bei Fehlern darf sich am isolierten Ziel nichts ändern.
5. Tatsächlich in ein separates Ziel zurückspielen; Datenbankintegrität, Fälle, Berichte, Benutzer, Rechte, Dokumentlinks, Dateien, HTML und Vorlagen vergleichen.
6. Mit neuem Instanzschlüssel und vollständigem Programmeinstieg starten. Quarantäne blockiert Fachzugriffe. Fehlender/falscher Recovery-Schlüssel und eine verfrühte Freigabe werden abgewiesen, ohne den geschützten Datenbestand zu ändern.
7. Das passende Sicherheits-/Zugangsabbild über die echten Vorschau-/Bestätigungs-APIs einspielen, freigeben und einen tatsächlichen neuen Serverprozess starten.
8. Mit Admin und Leser anmelden, Rechte sowie Vorlagen/PDF-Downloads prüfen. Der Browser muss dieselben gespeicherten Referenzwerte lesen und dasselbe PDF erneut erzeugen. Anschließend im Gesundheitsformular schreiben und den Wert nach Neuladen auch direkt aus SQLite bestätigen.
9. Die ursprünglichen Quelldateien, Schlüssel und der Snapshot müssen unverändert bleiben.

Die Programmquelle kommt aus einem separaten Git-Archiv mit ausdrücklich gehashten Ergänzungen. Die finalen Läufe installieren die Serverabhängigkeiten mit `npm ci` aus der Lockdatei neu. Das Restoreziel erhält diese Programme und die gesicherten HTML-/Vorlagenartefakte. Dies ist ein ausgeführter Ausgangsnachweis für den Bestand, keine zugesagte Wiederanlaufzeit eines produktiven Büros.


## Ausgeführte Nachweise

| Umgebung / Prüfung | Ergebnis | Nachweis |
|---|---|---|
| macOS/arm64, Node 22.23.2, frische Installation | 1.975/1.975 Tests bestanden, einschließlich Browser und kompletter Restorekette | [Manifest](pruefungen/ap01-ap02-final-node22.json), [TAP](pruefungen/ap01-ap02-final-node22.tap) |
| macOS/arm64, Node 24.18.0, frische Installation | 1.975/1.975 Tests bestanden, einschließlich Browser und kompletter Restorekette | [Manifest](pruefungen/ap01-ap02-final-node24.json), [TAP](pruefungen/ap01-ap02-final-node24.tap) |
| Absichtlich falsche Erfolgsantwort ohne SQL-Schreiben | unter beiden Node-Versionen erkannt; Wrapper erfolgreich nur wegen der erwarteten roten Datenprüfung | [Node 22](pruefungen/ap01-ap02-final-mutation-node22.json), [Node 24](pruefungen/ap01-ap02-final-mutation-node24.json) |
| Golden-PDF plus Vorher/Nachher beider Laufzeiten | fünf bytegleiche PDFs; eine Seite und sechs erwartete Textbestandteile; Sollseite visuell geprüft | [PDF-Abgleich](pruefungen/ap01-ap02-pdfvergleich.json) |
| Prüfwerkzeuge / Quellinventur | 12/12 Werkzeugtests bestanden; Inventur aktuell; Laufmanifeste gegen den finalen Quellstand abgeglichen | [Quell- und Reviewnachweis](pruefungen/ap01-ap02-review.json) |

Der [freigegebene Prüfzweig](https://github.com/christophzepp/betreuungsbuero/tree/codex/ap01-ap02-abschluss) enthält den isolierten Bestandsprüfstand; [Linux-CI-Lauf](https://github.com/christophzepp/betreuungsbuero/actions/runs/36319281096). Die öffentliche Übertragung wurde am 27.09.2026 ausdrücklich genehmigt. Kein Release, kein Merge und keine Änderung einer produktiven Installation.

## Wiederholen

```sh
npm ci --prefix tools/server-first/browser --ignore-scripts --no-audit --no-fund
(cd tools/server-first/browser && npx playwright install chromium)
python3 tools/server-first/inventory.py --check
python3 -m unittest discover -s tools/server-first -p 'test_*.py' -v
python3 tools/server-first/run_baseline.py --include-restore --install-dependencies --browser --evidence-label eigener-abnahmelauf
python3 tools/server-first/run_baseline.py --probe-missing-write --install-dependencies --evidence-label eigene-schreibverlustprobe
```

Für eine gesonderte Browserinstallation `--browser-path /absoluter/pfad` hinzufügen. Nur die Restorekette: `--restore-only --browser`. Die Probe erzeugt ausschließlich künstliche Daten und bindet den HTTP-Listener an einen zufälligen Loopback-Port. Providerzugriffe aus dem Browser werden blockiert. Übernommen werden nur explizite Laufzeit-Grundvariablen, keine Anwendungsdatenpfade, Zugangsdaten oder Node-Preloads. Als Nachweise bleiben JSON/TAP, Installationsprotokolle und synthetische PDFs/Screenshots; keine Datenbanken, Sicherungsarchive oder Schlüssel.

## Bekannte Bestandsabweichungen und Zuständigkeit

- Der alte Stammdaten-Endpunkt erkennt gleichzeitige Änderungen desselben Felds noch nicht über Revisionen; der zuletzt geschriebene Wert gewinnt. Unterschiedliche Teilpfade bleiben erhalten. AP-07 ersetzt diesen Vertrag; die vorhandenen Offline-Konfliktprüfungen bleiben erhalten.
- Beim Öffnen eines leseberechtigten Falls versucht die alte Oberfläche automatische Normalisierungs-/Berichtsschreibvorgänge. Der Server weist diese korrekt mit 403 ab; die Oberfläche kann deshalb einen Speicherhinweis anzeigen. Das ist als UX-Befund für AP-07/AP-12 erfasst, keine erteilte Schreibberechtigung und kein Datenverlust.
- Der Browser ergänzt Standardwerte und hält Exporthistorie/Archive an anderen Stellen seines Arbeitszustands. Die Prüfung verlangt alle ursprünglich gespeicherten Werte und erlaubt zusätzliche Standardfelder nach einer bewussten Bearbeitung. Direkt nach dem Restore gilt weiterhin der vollständige Datenbankvergleich.
- Die ersten Entwicklungsversuche zeigten zu frühe Vergleiche des noch aufgebauten Browserzustands, einen fehlenden HTML-Fehlerantwortparser im isolierten Routenprüfstand und zusätzliche Standardfelder im gespeicherten Verlauf. Die endgültigen Tests warten auf sichtbare Startbereitschaft und prüfen den tatsächlichen Speichervertrag. Die fehlgeschlagenen Versuche bleiben nachvollziehbar protokolliert.

Der vollständige PDF-Katalog gehört zu AP-20, Produktivbackup/Redundanz/Offsite zu AP-28, Geräte-/Lastabnahme zu AP-29 und verpflichtende Release-Sperren zu AP-30. Diese späteren Aufgaben werden nicht als unerledigte AP-01/AP-02-Implementierung ausgewiesen. Unabhängige menschliche Prüfung und übergeordnete Freigabegates bleiben gesondert offen; diese Dokumentation behauptet keinen bereits erfolgten Fremdreview.

[Revieweinheiten 64–66 und Quellhashes](pruefungen/ap01-ap02-review.json): 79, 250 und 43 geänderte handgeschriebene Zeilen; Lockdatei, PDF-Referenz und Quellinventar sind separat als erzeugte Artefakte erfasst.
