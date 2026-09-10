# Fristen & Wiedervorlagen – Umsetzung und Prüfung

Stand: 10. September 2026. Ausgangspunkt: `bc486ed` (zuletzt freigegebener Beta-Stand). Der korrigierte Entwurf ist als `mockup.html` in diesem Ordner dokumentiert. Die produktive Umsetzung steht in `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html`, im vorhandenen `fristen-script-v1` sowie im gekapselten `fristen-workspace-style-v1`.

Aktuelle Ergänzung: [Nachprüfung und weitere Fehlerkorrekturen](nachpruefung.md), mit 1.381 erfolgreichen Tests. Die folgenden Protokolle dokumentieren zusätzlich den ersten Umsetzungslauf.

## Oberfläche und Abgleich mit dem Entwurf

Die Oberfläche übernimmt Suche am oberen Rand, Fall- und Herkunftsfilter, offene/erledigte Einträge, aufklappbare Fälligkeitsgruppen, ausgeschriebene Dringlichkeit, wiederkehrende Symbole und einen rechten Detailbereich. Auf kleinen Bildschirmen bekommen Details, Formular, Filter und Dokumentenerkennung den verfügbaren Platz. Kopf und Aktionen bleiben sichtbar; der Inhalt scrollt unabhängig.

Die tatsächliche Anwendung wurde anhand von Bildschirmaufnahmen mit dem korrigierten Entwurf verglichen. Korrigiert wurden insbesondere fehlende Symbole, die doppelte Auswahlfeld-Markierung unter Safari, die Einbindung der mobilen Navigation sowie überlagernde Fortschrittsmeldungen. Fortschritt bei der Dokumentenerkennung erscheint innerhalb des Arbeitsbereichs. Die Vorschau-Kopfzeile des Mockups wurde durch die echten Schließen- und Speicheranzeigen der Anwendung ersetzt.

Bildschirmaufnahmen der echten Anwendung mit Testdaten liegen unter `chromium/` und `webkit/`: Liste, Details, Formular, Filter und Dokumentenerkennung; zusätzlich dunkle Detail- und Formularansichten. Es handelt sich um unveränderte Browseraufnahmen.

## Vollständigkeit

| Funktion im Bestand | Umsetzung / Prüfung |
| --- | --- |
| Aktueller Fall, alle Fälle, einzelner Fall | Seitenleiste und Filter; Zuordnung über Fall-ID; Fremdfall speichern und zum Ausgangsfall zurückkehren im Online-Modus und in der Vorführung geprüft |
| Suche in Titel, Institution, Notiz, Verfahren und Fall | Gemeinsame Suche oben; einzelne Filter entfernen; Suche leeren; Leerzustand |
| Zeitraum 30 / 90 / 180 Tage und zehn Jahre | Erhalten; zusätzlich ohne Begrenzung, überfällig, nächste sieben Tage und Rest des Monats |
| Fälligkeitsgruppen und erledigte Einträge | Aufklappbare Gruppen mit Anzahl; Offen / Erledigt / Alle |
| Kategorie, Herkunft und Priorität | Kombinierbare Filter auf Desktop und Mobil |
| Alle 14 Kategorien und sieben Wiederholungsoptionen | Vollständiges Formular; bestehende Datenwerte bleiben kompatibel |
| Titel, Formular/Verfahren, Institution | Erhalten; Institution mit Vorschlägen |
| Bescheiddatum, Fälligkeit, Datumshilfe | Native Datumsfelder; automatische Vorbelegung und explizit beschriftete 30-Tage-Hilfe |
| Titel oder Datum als Mindestangabe | Validierung; Kategorie dient gegebenenfalls als Titel |
| Priorität, Status und Notiz | Formular und Details; native Statuswerte für bestehende Aufrufe erhalten |
| Kalender / Aufgabe / beides / keines | Zwei unabhängige Optionen; alle vier Zuordnungen mit echten Speicherwegen geprüft |
| Wiedervorlage 0–365 Tage vorher | Vorberechnetes Datum sichtbar; verknüpfte Aufgabe hat den passenden Eintragstyp |
| Roter Kalendereintrag 09:00–09:30 | Vorhandenes Datenformat, Fallzuordnung und Zielkalender erhalten |
| Erledigen und Wiederöffnen | Verknüpfungen entfernen beziehungsweise wiederherstellen; vorhandene Abschlussdokumentation |
| Wiederkehrende Frist erledigen | Folgefrist mit passendem Monatsende; keine doppelte Folgefrist beim Wiederholen |
| Löschen und Abbrechen | Bestätigung im Detailbereich; bei Fehler bleibt der Eintrag erhalten |
| Automatische Falldokumentation | Vorhandener Dokumentationsdienst; Bearbeiten aktualisiert den Anlagevermerk, ohne einen falschen Erledigungsnachweis zu erzeugen; vorhandene Vermerke in Details sichtbar |
| Gesetzlich abgeleitete Fristen | Vorhandene Berechnungslogik erhalten; Vorschläge sichtbar und getrennt filterbar |
| Vorschlag übernehmen | Kategorie, Hinweis, Wiederholung und Wiedervorlage übernehmen; wiederholte Übernahme erzeugt keine Dublette |
| Vorschlag eines anderen Falls | Fall öffnen, danach übernehmen |
| Schuldenregulierung | Herkunft und Sperre sichtbar; Inhalt und Status bleiben dort gepflegt; Kalender-/Aufgabenzuordnung weiterhin hier steuerbar |
| Dokumente per Datei-Auswahl oder Ablegen | PDF, Bild und Text; mehrere Dateien; einzelne Dateien entfernen |
| OCR und KI-Erkennung | Bestehende Erkennungs- und Anbieteranbindung; zusätzlicher Prüfschritt vor dem Speichern |
| Erkannte Fristen korrigieren und auswählen | Titel, Kategorie, Daten, Institution und Notiz ändern; Auswahl und Zielfall beachten; Korrekturen beim Zurückgehen erhalten |
| Aufrufe aus Kalender, Posteingang und Wünsche/Bedarfe | Bestehende Einstiegspunkte, Feldkennungen und Herkunftsmetadaten erhalten; programmgesteuerte Vorbelegung geprüft |
| Excel-/Sicherungswege und Fristen-Widget | Bestehendes Datenmodell und öffentliche Schnittstellen erhalten |
| Aktualisieren, Schließen, Escape | Entwurf bleibt erhalten; ungespeicherte Änderungen werden vor dem Verwerfen abgefragt |
| Mobile Navigation und Chat | Bereichswechsel schützt den Entwurf; Chat-Rückkehr erhält das tatsächliche Formular inklusive Eingaben |
| Hell / Dunkel, 320–1440 Pixel | Gemeinsame Oberfläche; kein seitliches Herausragen; Aktionen auch bei geringer Höhe erreichbar |

## Behobene Fehler

- Wiederholungen am Monatsende liefen bisher über den Zielmonat hinaus. Monatsende und Schaltjahre werden berücksichtigt.
- Abgeleitete Vorschläge verloren ihren Hinweis und ihre Wiedervorlage beim Aufbereiten der Übersicht. Beide werden jetzt erhalten und übernommen.
- Vorhandene Kalender-/Aufgabenverknüpfungen werden aktualisiert. Erfolgreiche Teilschritte bleiben bei einem Fehler bestehen, sodass ein erneuter Versuch keine Dubletten erzeugt und vorhandene Anlagen erhalten bleiben.
- Ein unvollständiger Serienabschluss bleibt wiederholbar, einschließlich einer bereits angelegten Folgefrist.
- Der Fristen-Arbeitsbereich wartet auf eine bestätigte Speicherung der Falldaten. Ein fehlgeschlagener Serverabgleich wird nicht als Erfolg angezeigt.
- Geänderte oder zwischenzeitlich gelöschte Fristen werden beim Speichern erkannt; ein fremder neuer Stand wird nicht still überschrieben.
- Beim lokalen Abgleich werden Verknüpfungskennungen erst nach erfolgreicher Speicherung übernommen.
- In der Vorführung werden Fristen aller lokalen Fälle angezeigt und Änderungen tatsächlich im ausgewählten Fall gespeichert.
- Fehlgeschlagenes Nachladen erhält die bekannten Vorschläge und zeigt eine verständliche Fehlermeldung.
- Formularabbruch, programmgesteuerte Vorbelegung und der Start ohne bereits geöffneten Dialog sind durch eigene Prüfungen abgesichert.

## Prüfungen und Grenzen

Die Browserprüfungen laden die ausgelieferte HTML-Anwendung. Fälle und Serverantworten sind kontrollierte Testdaten; externe Schreibzugriffe werden abgefangen. Die Dokumentenerkennung liest echte Testdateien, während die Antwort des KI-Anbieters simuliert wird. Es wurden keine kostenpflichtigen Live-KI-Anfragen oder Schreibzugriffe auf fremde Kalender ausgeführt.

Die Prüfergebnisse und genauen Aufrufe stehen in `pruefergebnisse.json` sowie in den zugehörigen Protokollen. Die vollständige Serversuite umfasst **1.380 erfolgreiche Tests**. Zusätzliche Browserprüfungen decken Fristen, Aufgaben und Kalender ab. Der erste eingeschränkte Suite-Lauf konnte lokale Testserver nicht öffnen; der abschließende Lauf mit erlaubten lokalen Testports war vollständig erfolgreich.

Prüfprogramme:

- `server/scripts/qa-fristen-workspace.cjs`: reale Oberfläche, Speicherung, Fehlerfälle und Bildschirmgrößen in Chromium und WebKit.
- `server/tests/html-fristen-workspace.test.cjs`: Monatsenden, lokale Speicherung, Wiederholbarkeit, bestätigter Fallspeicher und Start ohne Dialog.
- `server/scripts/qa-todo-workspace-edge.cjs`: Aufgaben-Regression einschließlich Anlagen und Kalender-Rückkehr.
- `server/scripts/qa-calendar-design.cjs` mit `CALENDAR_QA_DRAG=1`: Kalender-Regression einschließlich Datum, Uhrzeit und Speicherfehlern.

Die Änderungen wurden lokal umgesetzt. Ein Push wurde in diesem Arbeitsschritt nicht beauftragt; Main bleibt unverändert.
