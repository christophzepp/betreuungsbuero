# Fehlerbehebung der Gesamtsuite

Stand: 10. September 2026. Ergebnis: **1371 Tests bestanden, 0 fehlgeschlagen, 0 übersprungen.**

## Ursachen und Korrekturen

| Bisherige Ausfälle | Ursache | Korrektur |
| --- | --- | --- |
| 15 Strukturprüfungen | Veralteter Sollstand: 311 Script-/Datenblöcke bzw. 229 JavaScript-Blöcke. Der veröffentlichte Stand enthält bereits 315 bzw. 233. | Gemeinsame Struktur- und Syntaxprüfung für sämtliche betroffenen Tests; zusätzlich Schutz gegen doppelte Script-IDs und fehlende neue Bausteine. |
| 1 Mobil-Registry-Prüfung | Die Negativliste verbot noch Ordnergenerator, Fallbeginn und Fallabschluss, obwohl diese mittlerweile mobil freigegeben sind. | Die freigegebenen Module werden positiv auf Einstieg, Profil, eindeutige Wurzel und Position in der Standardreihenfolge geprüft. Noch ausgeschlossene bzw. veraltete Haupteinträge bleiben ausgeschlossen. |
| 1 sporadischer Verbindungsabbruch | Der Testclient nutzte den globalen HTTP-Verbindungspool auch über lange synchrone Prüfpausen. Außerdem hing der Status-Einzeltest von der Benutzeranlage früherer Tests ab. | Eigene Testvorbereitung vor allen Tests, Warten auf den lokalen Serverstart, frische HTTP-Verbindungen und vollständiger Server-/Datenbankabschluss vor dem Entfernen der temporären Dateien. |

Die Herkunft der vier zusätzlichen JavaScript-Blöcke wurde am Git-Verlauf geprüft:

- `e7cf3f7`: `mobile-document-editor-v1` und `mobile-document-library-v1`.
- `6a0e9df`: `desktop-case-wizard-v1` und `mobile-case-wizard-v1`.
- Bereits in `HEAD` vor dem Aufgabenumbau vorhanden. Kalender- und Aufgabenumbau erhöhen die Blockzahl nicht.

Die gemeinsamen Prüfungen stehen in `server/tests/helpers/html-scripts.cjs`. Es wurden keine Tests deaktiviert. Vorhandene fachliche Prüfungen bleiben erhalten. Für diese Suite-Korrektur war keine weitere Änderung am Produktcode erforderlich.

Betroffene Strukturprüfungen: Controlling, Datenschutz, Online-Einstellungen, JSON-Fallimport, Gesamtexport, Adressbuch-Dunkelmodus, Fallakte/Finanzen-Dunkelmodus, Dashboard, Desktop-Erkennung, Datei-Explorer-Dunkelmodus, abschließender HTML-Audit, Mail-Dunkelmodus, Entfernung alter Modulordner, Rechnungsverknüpfung und Sicherungsvollständigkeit. Die bereits aktualisierten Fall-ID-, Kalender-/Aufgaben- und Online-Fallladeprüfungen verwenden ebenfalls den gemeinsamen Sollstand.

## Nachweise

- [Gesamtsuite](gesamtsuite-korrigiert.txt): 1371/1371 bestanden, rund 35 Sekunden.
- [Gezielte Prüfung der betroffenen Bereiche](suite-gezielt-korrigiert.txt): 266/266 bestanden.
- [Statusprüfung als Einzeltest](statusabfrage-isoliert-korrigiert.txt): 1/1 bestanden, unabhängig von vorausgehenden Tests.
- Vier zusätzliche Gegenproben ausschließlich im Arbeitsspeicher: fehlender veröffentlichter Baustein, doppelte Script-ID, eingefügter Syntaxfehler und zusätzlicher Scriptblock werden jeweils erkannt.
- Die beim Gesamtlauf neu erzeugten PDF-Testdateien wurden auf ihren unveränderten Ausgangsstand zurückgesetzt.

Ausgeführt wurde die vollständige vorhandene Suite mit `node --test server/tests/*.test.js server/tests/*.test.cjs`. Die Serverprüfungen verwenden lokale Testserver und temporäre Datenbanken. Die früheren Fehler stehen weiterhin in [gesamtsuite.txt](gesamtsuite.txt).

Kein Push und kein Eingriff in Main.
