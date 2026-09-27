# AP-01 und AP-02: technischer Abschluss

Stand: 27.09.2026. Der Abschluss bezieht sich auf die ursprünglichen Basispakete aus Kapitel 04. Er ersetzt weder G0 noch die spätere Produktfreigabe. Die technische Abnahme ist lokal und in der freigegebenen Linux-/macOS-CI bestanden. AP-01 und AP-02 sind technisch abgeschlossen; die unabhängige menschliche Prüfung bleibt offen.

## AP-01: Referenz- und Regressionstestbasis

- Vier reproduzierbare synthetische Profile: kleiner Fall, 500 historische Ausgaben/100 Diagnosen, historischer Fall mit unbekannten Schlüsseln und Sonderwerten sowie konkurrierende Teiländerungen.
- Eigentümer, Leser, fremder Nutzer, fehlende Sitzung, entzogenes Schreib-/Dokumentrecht und Lokalmodus sind geprüft. Es werden echte temporäre SQLite-Dateien und die bestehenden Routen verwendet.
- Ein tatsächlicher SQLite-Abbruch muss HTTP 500 auslösen und den letzten bestätigten Datenstand bewahren. Eine getrennte Mutation lässt absichtlich den SQL-Schreibvorgang weg; die ansonsten erfolgreiche HTTP-Antwort muss an den gespeicherten Daten scheitern.
- Neuladen wird sowohl durch einen unabhängigen SQLite-Prozess als auch durch den vollständigen Browser geprüft. Alle bisherigen Source-Slice-Tests bleiben erhalten.
- Der Browser meldet sich über das echte Formular an, öffnet Stammdaten, liest den Fall/Bericht, erzeugt das Referenz-PDF und prüft nach dem Restore eine Eingabe über das Gesundheitsformular samt vollständigem Neuladen und unabhängiger SQLite-Kontrolle.
- Der CI-Workflow verlangt unter Node 22 und 24 frische Abhängigkeiten, die gesamte Suite, Browser-/Restoreprobe und den erwarteten roten Schreibverlusttest. Unvollständige, übersprungene oder abgebrochene Prüfläufe können nicht grün werden.

Der [maschinenlesbare Referenz- und Fehlerkatalog](ap01-ap02-referenzkatalog.json) verbindet Sollwerte, Rechte, Prüfwege und bekannte Abweichungen. Das [PDF-Sollartefakt](../../../../server/tests/fixtures/server-first/reference-report.pdf) wurde mit Poppler gerendert und visuell kontrolliert: Fallname, Kennung, Einnahmen und Ausgaben sind vollständig lesbar. Die Browserprüfung vergleicht die neu erzeugten Bytes mit diesem festen Sollstand und miteinander. Der Zeitstempel ist hierfür festgelegt; die Produktionsuhr wird nicht verändert.

## AP-02: vollständige synthetische Ausgangswiederherstellung

Die [bestehende Wiederherstellungsprobe](../../../../server/tests/server-first-restore-rehearsal.test.cjs) ist um Browserbedienung und neu erzeugte PDF-Ausgabe ergänzt. Die komplette Kette umfasst:

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

## Ausgangsrunbook und Sicherungsgrenzen

1. Geprüfte Quellrevision, Lockdatei, HTML und Vorlagen zusammen bereithalten; Quell-, Schlüssel-, Sicherungs- und Zielverzeichnisse ausdrücklich festlegen.
2. Fall-, Büro- und Recovery-Abbilder vor dem Backup konsistent erzeugen. Die Backup-CLI benötigt für ihren authentifizierten Abgleich sowohl Instanz- als auch Recovery-Schlüssel.
3. Nur einen vollständigen Snapshot verwenden. Programmquellen/Abhängigkeiten kommen aus dem zugehörigen Buildstand; `.env`, Instanzschlüssel und aktive Recovery-Schlüsseldatei gehören nicht zum Datensnapshot und müssen getrennt verfügbar sein.
4. Ein isoliertes Ziel mit passenden Elternverzeichnissen vorbereiten. Dry-run und Manifestprüfung ausführen; vor der tatsächlichen Aktivierung die Zielanwendung anhalten.
5. Datenbank, Dokumente, HTML und Vorlagen gemeinsam wiederherstellen. Der Start bleibt zunächst in Quarantäne. Die Restore-CLI kann Daten ohne Entschlüsselungsschlüssel bereitstellen; fachliche Freigabe und Entschlüsselung bleiben bei fehlendem/falschem Schlüssel gesperrt. Die ursprüngliche Instanz bleibt unberührt.
6. Sicherheits-/Zugangsabbild prüfen und mit dem separat verwahrten Schlüssel wiederherstellen. Erst nach Fall-/Rechte-/Datei-/PDF-Abgleich freigeben, neu starten und Anmeldung sowie eine bestätigte Bearbeitung nach Neuladen kontrollieren.

Die reproduzierbaren Befehle unten führen diese Kette mit künstlichen Daten aus. Produktive Installationskonfiguration, reale Provider, externe Dokumentwurzeln, Offsite-/HA-Wiederanlauf und reale Bürovolumina sind keine nachgewiesenen Bestandteile dieser Ausgangsprobe. In der synthetischen Probe werden alte Zugriffstokens verworfen; für ein reales Büro ist das keine vorweggenommene Entscheidung.


## Ausgeführte Nachweise

| Umgebung / Prüfung | Ergebnis | Nachweis |
|---|---|---|
| macOS/arm64, Node 22.23.2, frische Installation | 1.977/1.977 Tests bestanden, einschließlich Browser und kompletter Restorekette; 159,28 s | [Manifest](pruefungen/ap01-ap02-final-v3-node22.json), [TAP](pruefungen/ap01-ap02-final-v3-node22.tap) |
| macOS/arm64, Node 24.18.0, frische Installation | 1.977/1.977 Tests bestanden, einschließlich Browser und kompletter Restorekette; 158,30 s | [Manifest](pruefungen/ap01-ap02-final-v3-node24.json), [TAP](pruefungen/ap01-ap02-final-v3-node24.tap) |
| Ubuntu 24.04, Node 22.23.2 und 24.18.0, frische Installation | je 1.975/1.975 Tests bestanden; 195,69 s / 193,01 s; Browser/Restore und Schreibverlustprobe erfolgreich | [CI-Nachweis](pruefungen/ap01-ap02-ci-final.json) |
| macOS 14, separater Pflichtjob für vorhandene Bildvergleiche | 2/2 Tests bestanden; 9,47 s; zusammen mit Linux alle 220 Testdateien abgedeckt | [Golden-Manifest](pruefungen/ap01-ap02-ci-final-macos-golden/macos-golden.json) |
| Absichtlich falsche Erfolgsantwort ohne SQL-Schreiben | unter beiden Node-Versionen erkannt; Wrapper erfolgreich nur wegen der erwarteten roten Datenprüfung | [Node 22](pruefungen/ap01-ap02-final-mutation-node22.json), [Node 24](pruefungen/ap01-ap02-final-mutation-node24.json) |
| Golden-PDF plus Vorher/Nachher beider Laufzeiten auf macOS und Linux | neun bytegleiche PDFs; eine Seite und sechs erwartete Textbestandteile; Sollseite visuell geprüft | [PDF-Abgleich](pruefungen/ap01-ap02-pdfvergleich-final.json) |
| Prüfwerkzeuge / Quellinventur | 13/13 Werkzeugtests bestanden; Inventur aktuell; Laufmanifeste gegen den veröffentlichten Quellstand abgeglichen | [Quellbindung](pruefungen/ap01-ap02-source-binding-final.json), [Reviewnachweis](pruefungen/ap01-ap02-review.json) |

Der [freigegebene Prüfzweig](https://github.com/christophzepp/betreuungsbuero/tree/codex/ap01-ap02-abschluss) enthält den isolierten Bestandsprüfstand; [CI-Lauf](https://github.com/christophzepp/betreuungsbuero/actions/runs/36320080346) für Quellcommit `525f67dfb2338969cf30c2f850d09ce59a75a36b`. Die öffentliche Übertragung wurde am 27.09.2026 ausdrücklich genehmigt. Kein Release, kein Merge und keine Änderung einer produktiven Installation. Spätere reine Nachweis-Commits verändern diesen geprüften Quellstand nicht.

## Wiederholen

```sh
npm ci --prefix tools/server-first/browser --ignore-scripts --no-audit --no-fund
(cd tools/server-first/browser && npx playwright install chromium)
python3 tools/server-first/inventory.py --check
python3 -m unittest discover -s tools/server-first -p 'test_*.py' -v
python3 tools/server-first/run_baseline.py --include-restore --install-dependencies --browser --evidence-label eigener-abnahmelauf
python3 tools/server-first/run_baseline.py --probe-missing-write --install-dependencies --evidence-label eigene-schreibverlustprobe
```

Die Befehle oben führen auf macOS alle 220 Dateien einschließlich der beiden vorhandenen `sips`-Bildtests aus. Unter Linux `--portable` hinzufügen; die beiden übrigen Dateien werden im verpflichtenden macOS-Job mit `--golden-only --install-dependencies` geprüft. Jede Teilauswahl lehnt übersprungene Tests ab.

Für eine gesonderte Browserinstallation `--browser-path /absoluter/pfad` hinzufügen. Nur die Restorekette: `--restore-only --browser`. Die Probe erzeugt ausschließlich künstliche Daten und bindet den HTTP-Listener an einen zufälligen Loopback-Port. Providerzugriffe aus dem Browser werden blockiert. Übernommen werden nur explizite Laufzeit-Grundvariablen, keine Anwendungsdatenpfade, Zugangsdaten oder Node-Preloads. Als Nachweise bleiben JSON/TAP, Installationsprotokolle und synthetische PDFs/Screenshots; keine Datenbanken, Sicherungsarchive oder Schlüssel.

## Plattformabweichungen aus der echten CI

Der [erste Linux-Lauf](pruefungen/ap01-ap02-ci-erster-lauf.json) blieb mit Fehlern erhalten und führte zu vier konkreten Korrekturen:

- Übergabetests verwenden jetzt das betriebssystemeigene temporäre Verzeichnis statt `/private/tmp`.
- Die Backup-CLI übernimmt von BSD/GNU `stat` nur einen erfolgreichen numerischen Einzelwert. Zuvor vermischte der Fallback unter Linux Dateisystemtext mit der Kennzahl; Änderungen am freien Speicher erschienen dadurch irrtümlich als Datenträgerwechsel. Der gleiche sichere Leser prüft den Modus der restic-Passwortdatei. Eine reale Dateisystemprobe und Fehlerausgaben mit Teil-/Mehrzeilentext prüfen das Verhalten.
- Die CI pinnt Node 22.23.2 und 24.18.0. Der erste Lauf mit dem beweglichen Tag `24` wählte 24.21.0 und brach im nativen SQLite-Modul ab. Die neue Versionslinie wird dadurch nicht auf eine alte Laufzeit festgelegt; spätere Aktualisierungen erfordern einen eigenen Kompatibilitätsnachweis.
- Zwei unveränderte Bildvergleichstests benötigen macOS `sips`. Sie sind im eigenen macOS-CI-Job verpflichtend; die Linuxläufe führen alle übrigen Dateien aus. Die getestete Auswahl deckt jede Datei genau einmal je zuständiger Plattform ab. Übersprungene Tests bleiben in jedem Teiljob Fehler.

Im erneuten lokalen Gesamtlauf wurde zusätzlich eine Minutenwechsel-Flakiness eines vorhandenen Reparaturtests sichtbar. Der Dateiname enthält die Minute; nach der Reparatur kann deshalb eine neue Datei-ID aktuell sein. Der Test erzwingt nun mit kontrollierter Zeit genau diesen Wechsel und liest das aktuell verknüpfte Abbild. Produktive Reparaturlogik wurde dafür nicht geändert.

## Bekannte Bestandsabweichungen und Zuständigkeit

- Der alte Stammdaten-Endpunkt erkennt gleichzeitige Änderungen desselben Felds noch nicht über Revisionen; der zuletzt geschriebene Wert gewinnt. Unterschiedliche Teilpfade bleiben erhalten. AP-07 ersetzt diesen Vertrag; die vorhandenen Offline-Konfliktprüfungen bleiben erhalten.
- Beim Öffnen eines leseberechtigten Falls versucht die alte Oberfläche automatische Normalisierungs-/Berichtsschreibvorgänge. Der Server weist diese korrekt mit 403 ab; die Oberfläche kann deshalb einen Speicherhinweis anzeigen. Das ist als UX-Befund für AP-07/AP-12 erfasst, keine erteilte Schreibberechtigung und kein Datenverlust.
- Der Browser ergänzt Standardwerte und hält Exporthistorie/Archive an anderen Stellen seines Arbeitszustands. Die Prüfung verlangt alle ursprünglich gespeicherten Werte und erlaubt zusätzliche Standardfelder nach einer bewussten Bearbeitung. Direkt nach dem Restore gilt weiterhin der vollständige Datenbankvergleich.
- Die ersten Entwicklungsversuche zeigten zu frühe Vergleiche des noch aufgebauten Browserzustands, einen fehlenden HTML-Fehlerantwortparser im isolierten Routenprüfstand und zusätzliche Standardfelder im gespeicherten Verlauf. Die endgültigen Tests warten auf sichtbare Startbereitschaft und prüfen den tatsächlichen Speichervertrag. Die fehlgeschlagenen Versuche bleiben nachvollziehbar protokolliert.

Der vollständige PDF-Katalog gehört zu AP-20, Produktivbackup/Redundanz/Offsite zu AP-28, Geräte-/Lastabnahme zu AP-29 und verpflichtende Release-Sperren zu AP-30. Diese späteren Aufgaben werden nicht als unerledigte AP-01/AP-02-Implementierung ausgewiesen. Der Paketstatus und die konkreten Kriterien sind in der [maschinenlesbaren Abnahme](ap01-ap02-abnahme.json) hinterlegt. Unabhängige menschliche Prüfung und übergeordnete Freigabegates bleiben gesondert offen; diese Dokumentation behauptet keinen bereits erfolgten Fremdreview.

[Revieweinheiten 64–68 und Quellhashes](pruefungen/ap01-ap02-review.json): 79, 250, 121, 67 und 9 geänderte handgeschriebene Zeilen; Lockdatei, PDF-Referenz und Quellinventar sind separat als erzeugte Artefakte erfasst.
