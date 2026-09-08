# Drei bestehende Testfehler – behoben am 08.09.2026

Die drei im ursprünglichen Release bereits nachgewiesenen Fehler wurden im aktuellen Arbeitsstand reproduziert und behoben. Der frühere Nachweis steht in [baseline-fehler.txt](mobile-fundament-v1/baseline-fehler.txt), die neue Reproduktion in [vorher.txt](bestehende-testfehler-v1/vorher.txt).

| Fehlgeschlagener Test | Ursache und Auswirkung | Korrektur |
| --- | --- | --- |
| `backup-table-registry.test.js`: gemeinsame Registrierung klassifiziert jede Anwendungstabelle oder schließt sie begründet aus | Die Datenbank enthält seit der KI-Modellfreigabe `office_ai_config.allowed_models`; der verpflichtende Recovery-Spaltenvertrag führte diese Spalte noch nicht auf. | Spalte in den gemeinsamen, weiterhin streng geprüften Sicherungsvertrag aufgenommen. |
| `recovery-bootstrap.test.js`: neuer ENCRYPTION_KEY erzwingt Admin-Quarantäne und atomaren Schema-3-Doppelrestore | Derselbe Schemafehler brach schon die Erstellung des portablen Recovery-Paars ab. Der Test erreichte deshalb die eigentliche Rücksicherung nicht. | Der korrigierte Vertrag ermöglicht den vollständigen Ablauf. Der Test sichert jetzt ausdrücklich eine nicht leere Modellfreigabe, verändert den Datenbankwert und prüft die Wiederherstellung der ursprünglichen Freigabe nach Schlüsselwechsel. |
| `html-v230-print-golden.test.cjs`: v230-Druck des Vermögensverzeichnisses entspricht den Golden-Referenzen | Das Renderwerkzeug brach mit `Cannot find module 'pdf-lib'` ab. Die Bibliothek war nur im separaten Werkzeugpaket deklariert und wurde bei der Serverinstallation nicht installiert. | `pdf-lib` in der bereits vom Werkzeug verwendeten Version 1.17.1 als Entwicklungsabhängigkeit in Server-Paket und Lockdatei aufgenommen. Fehlende Abhängigkeiten werden verständlich gemeldet; Renderfehler bleiben im Testprotokoll sichtbar. |

Auch der bisher aufgrund derselben fehlenden Bibliothek übersprungene Overlay-Golden-Test löst seine Abhängigkeit jetzt über Node auf und wird auf diesem Rechner tatsächlich ausgeführt.

Die zusätzlichen Prüfungen stellen sicher, dass fehlende Pflichtspalten weiterhin abgelehnt werden und dass die erlaubten KI-Modelle den Sicherungs- und Rücksicherungsablauf vollständig überstehen. Die Schema-Prüfung wurde nicht gelockert.

## Prüfung

- [Gezielte Tests](bestehende-testfehler-v1/gezielte-tests.txt): **18 erfolgreich, 0 Fehler, 0 übersprungen**.
- [Gesamte Testsuite](bestehende-testfehler-v1/vollstaendige-testsuite.txt): **1.359 erfolgreich, 0 Fehler, 0 übersprungen**, Laufzeit rund 47 Sekunden.
- PDF-Golden-Vergleich: Seiten 1, 3 und 4 des Vermögensverzeichnisses bei 1240 × 1754 Pixeln jeweils **0 Pixelabweichung**. Kopf, Tabelle, Übertrag und Summenblock zusätzlich visuell geprüft. Die Referenzbilder wurden nicht geändert.
- Die temporär neu erzeugten, versionierten Test-PDFs wurden nach der Prüfung auf ihren Ausgangsstand zurückgesetzt.
- Mobile App-HTML durch diese Korrektur unverändert; SHA-256: `b3540da9f70e0860c92239e264da79172a6c878942989b0641c2f7fb0229fdf7`.
- Änderungen lokal im Arbeitsstand; kein Deployment.

Für eine frische Entwicklungsinstallation im Verzeichnis `server`:

```sh
npm ci --include=dev
npm test
```

Die beiden bestehenden PDF-Bildvergleiche benötigen weiterhin macOS (`sips`) und Python mit Pillow. Ohne diese Plattformwerkzeuge melden sie einen begründeten Skip. Die hier dokumentierte Prüfung lief mit beiden Werkzeugen und ohne übersprungene Tests.

Maschinenlesbares Ergebnis: [ergebnis.json](bestehende-testfehler-v1/ergebnis.json).
