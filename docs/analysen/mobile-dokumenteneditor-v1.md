# Mobiler Dokumenteneditor

Stand: 09.09.2026. Grundlage: Beta `b4dfffc` zuzüglich der lokal vorhandenen Korrektur der Anmerkungswerkzeuge. Umsetzung für den Beta-Zweig `develop`.

## Bedienung

Der bisherige Dokumenteneditor öffnet auf dem Smartphone als Formularansicht mit blauer Kopfzeile, Dokumenttitel und Fallkontext. Die A4-Darstellung bleibt für Vorschau, Ausgabe und Desktop erhalten.

- Die Dokumentabschnitte lassen sich einzeln aufklappen. Die Suche findet Abschnitte und beschriftete Felder auch in geschlossenen Abschnitten und führt direkt zur Eingabe.
- Empfänger und Berichtszeitraum stehen unter „Dokumentangaben“. Plausibilitätsprüfung, Stammdatenverknüpfungen und die Herkunft der Feldwerte bleiben sichtbar. KI-Stichpunkte sind aufklappbar.
- Formulare sind einspaltig. Tabellen erscheinen als beschriftete Einträge mit ihren ursprünglichen Feldern und Berechnungen. Freitextformatierung, Anlagen und Unterschriften bleiben bedienbar.
- „Prüfen“, „Vorschau“ und „Export“ sind unten erreichbar. Die Hauptnavigation folgt weiterhin dem vereinbarten Scroll- und Tastaturverhalten; ausgeblendete Navigation gibt Platz frei.
- „Dokumentaktionen“ enthält die ursprünglichen dokumentabhängigen Werkzeuge sowie Archivfassungen und Dokumenteinstellungen. Die Aktionen delegieren an die vorhandenen Schaltflächen, einschließlich ihrer deaktivierten Zustände.
- Eingaben laufen weiterhin durch die bestehenden Speicherbindungen. Es wurde kein zusätzlicher Speichern-/Abbrechen-Ablauf eingeführt, der fälschlich einen getrennten Entwurf versprechen würde.
- Beim Einstieg aus „Zum Dokument“ in den Genehmigungen führt Zurück wieder zur betreffenden Genehmigung. Abschnittszustand und Scrollposition werden pro Fall und Dokument wiederhergestellt.

## Vorschau und Export

Die mobile Vorschau erzeugt über die vorhandene PDF-Pipeline eine echte PDF des aktuellen Dokuments. Die Seiten werden mit dem vorhandenen PDF.js-Renderer bei Bedarf angezeigt. Vorschaufehler bieten einen erneuten Versuch; die Eingaben bleiben erhalten. Die Vorschau legt keine Archivfassung an.

Diese Vorschau enthält den aktuellen Dokumentbestandteil ohne Anlagen. Das vollständige Paket mit Anschreiben, Anlagen und weiteren Ausgabeoptionen wird weiterhin unter „Export“ zusammengestellt. Der Exportdialog ist ebenfalls mobil angepasst: große Ausgabeoptionen, aufklappbare Einstellungen und ein fest erreichbarer Abschluss mit Zurück, PDF-Vorschau und Export starten.

## Umfang und technische Einbindung

Alle 89 registrierten Dokumenttypen wurden inventarisiert. 88 verwenden die neue gemeinsame mobile Editoransicht; die Rechnungslegung behält ihre bereits vorhandene mobile Umsetzung. Ein zusätzlich im Test registriertes individuelles Formular nutzt ebenfalls den Adapter.

Die bestehende DOM-Struktur mit allen Eingabefeldern und Ereignisbindungen wird übernommen, nicht als zweiter Editor nachgebaut. Beim Wechsel zur Desktopansicht werden die mobilen Ergänzungen zurückgebaut. Bestehende Inline-Dokumentzyklen behalten ihre ursprüngliche Übernahme- und Rückkehrlogik; diese Assistenten wurden nicht als eigenständige neue mobile Abläufe gestaltet.

Die Layoutregeln gelten für die Bildschirmausgabe. Im Druck bleiben Originalüberschriften und sämtliche Abschnitte erhalten. Der PDF-Export nutzt die bestehende Ausgabe-Pipeline.

Implementierung: `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html`, Block `mobile-document-editor-v1` und Freigabe des vorhandenen PDF.js-Laders über `__ensureDocumentPdfJs`.

## Prüfung

| Prüfung | Ergebnis |
|---|---:|
| Browserprüfungen WebKit | 290 erfolgreich |
| Browserprüfungen Chromium | 290 erfolgreich |
| Bestehende Codeprüfungen | 34 erfolgreich |
| Ausführbare Inline-Skripte syntaktisch geprüft | 230 |
| Eingebettete lange Zeichenblöcke gegenüber Git-Basis | 99 unverändert |
| Vorhandenes NUL-Byte | erhalten |

Die Browserprüfungen vergleichen die Eingabefelder der Desktop- und Mobilansicht in allen 88 angepassten Dokumenttypen. Alle Abschnitte werden zur Überlaufprüfung geöffnet. Getestet wurden außerdem originale Eingabebindungen, dynamische Formulare, Feldsuche, Wiederherstellung von Fokus und Scrollposition, der Rückweg zur Genehmigung, KI-Chat-Rückkehr, Anlagenaufnahme, Freitext, Tabellenwerte und Berechnungen, PDF-Erzeugung mit echtem Renderer, die Einstellungen des kombinierten Exports sowie der Rückwechsel zum Desktop. Keine Browserfehler aufgezeichnet.

Visuell geprüft: Genehmigung, freies Dokument, Tabellenbericht, umfangreicher Antrag, Abschnittssuche, Aktionen, PDF-Vorschau und Export. Breiten 390 und 320 Pixel, helle und dunkle Darstellung sowie ein simulierter sichtbarer Tastaturbereich von 520 Pixeln. WebKit wurde automatisiert geprüft; kein physisches iPhone. Ein realer Versand oder produktiver Speichervorgang wurde nicht ausgeführt.

Browserprüfung: `server/scripts/qa-mobile-document-editor.cjs`, mit `PLAYWRIGHT_MODULE`, optional `MOBILE_QA_BROWSER=webkit` und `MOBILE_QA_OUTPUT`.

Die 34 bestehenden Prüfungen stammen aus `html-care-notice-fields-editor`, `html-initial-editor-optimization`, `html-document-textarea-autogrow`, `html-free-document-subject-export`, `html-unified-document-print-layout` und `html-mobile-accounting` unter `server/tests`.

[Ansichten aus der ausgeführten App](mobile-dokumenteneditor-v1/index.html) · [WebKit-Protokoll](mobile-dokumenteneditor-v1/pruefungen/browser-webkit.txt) · [Chromium-Protokoll](mobile-dokumenteneditor-v1/pruefungen/browser-chromium.txt) · [Dokumentinventar](mobile-dokumenteneditor-v1/pruefungen/dokumentinventar.json)
