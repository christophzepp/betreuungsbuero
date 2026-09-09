# Desktop-Review: Fallbeginn und Fallabschluss

Lokaler Arbeitsstand vom 9. September 2026. Aufbauend auf den bereits lokal umgesetzten mobilen Fallassistenten; für die gemeinsame Beta-Veröffentlichung am 9. September 2026 freigegeben.

[Vorher-Nachher-Vergleich und alle 17 Schritte](desktop-fallassistenten-v1/index.html)

## Oberfläche

Beide Assistenten behalten ihren geführten Ablauf und die bisherigen fachlichen Schritte. Eine seitliche Schrittauswahl mit den bestehenden Freigaben, eine kompakte Fortschrittsanzeige und eine feste Fußzeile ersetzen die doppelte, platzintensive Navigation. Zurück und Weiter bleiben erreichbar, während der Inhalt unabhängig scrollt. Im Kopf stehen Fallkontext, Speicherstatus, „Zwischenstand speichern“ und „Speichern und schließen“.

Die Formulare erhalten gleichmäßige Abstände, lesbarere Beschriftungen, größere Bedienelemente und sichtbare Tastaturfokusse. Offene Vorgänge im Fallabschluss bieten umbrochene Aktionsgruppen; ihre Abschnitte sind auch per Tastatur aufklappbar. Helle und dunkle Darstellung sowie schmalere Desktopfenster wurden berücksichtigt. Eingebettete Dokumentabschnitte behalten kontrastreiche Überschriften und Feldbezeichnungen.

Die umfangreichen Dokumentseiten nutzen eine eigene Arbeitsfläche:

- Links eine scrollbare Dokumentauswahl mit Suche nach Titel oder Empfänger, Statusfilter und „Dokument ergänzen“.
- Rechts das gewählte Dokument mit seinem vollständigen Editor, Export/Versand, Vorschlägen, KI-Werkzeugen und bestehenden Fortschrittsmarkierungen.
- Hinweise, Sammelaktionen und vorhandene Checklisten sind über einen aufklappbaren Bereich erreichbar.
- Dokumentwechsel erhält die individuellen Texte und Anlagen. Die verschiedenen Schreiben auf derselben Vorlage bleiben getrennt.
- Schlussbericht und Schlussrechnung bleiben eigenständige Dokumente. Die vorhandene Erstellungskontrolle ist zusätzlich über „Erstellt“ filterbar.
- Ein geöffneter Exportdialog gilt weiterhin nicht als bestätigter Versand.

## Gefundene und korrigierte Fehler

| Auslöser / bisheriges Verhalten | Korrektur |
| --- | --- |
| Speichern auf der aktuellen Desktopseite übernahm nicht zuverlässig die noch sichtbaren Felder. | Aktuelle Formular- und Dokumenteingaben werden vor dem Speichern erfasst; Änderungen lösen auch eine verzögerte Sicherung aus. |
| Mehrere schnelle Speicheraufrufe oder ein unmittelbar neu gestarteter Lauf konnten sich gegenseitig überholen. | Unveränderliche Zustandskopien und eine Warteschlange erhalten die einzelnen Läufe innerhalb der geöffneten Anwendung. Eine verspätete Rückmeldung markiert keinen neuen leeren Lauf als gespeichert. |
| Fehler beim Laden/Speichern konnten folgenlos bleiben oder den Assistenten trotzdem schließen. | Fehler bleiben sichtbar; „Speichern und schließen“ sowie Abschluss schließen erst nach erfolgreicher Speicherung. Eine fehlgeschlagene Bestandsabfrage wird nicht mit einer leeren Liste überschrieben. |
| Gespeicherter Fallabschluss konnte am inzwischen ausgewählten anderen Fall fortgesetzt werden. | Neue Zwischenstände speichern die Fall-ID. Online wird vor dem Fortsetzen der zugehörige Fall geladen und geprüft. Ohne erfolgreiche Zuordnung wird das Öffnen abgebrochen. |
| Späte Antworten auf „Offene Punkte“ konnten nach Navigation oder Schließen wieder die alte Ansicht aufbauen. | Antworten gelten nur noch für den weiterhin geöffneten Lauf, Fall und Schritt. Fehler erhalten eine eigene Ansicht mit „Erneut laden“. |
| Aufgaben verwendeten beim Anzeigen/Ändern teilweise `due` statt des Serverfeldes `dueAt`. | Fälligkeiten werden aus dem vorhandenen Feld gelesen und mit `dueAt` gespeichert. |
| Terminänderungen löschten den Termin und legten ihn neu an. | Änderung über den bestehenden PUT-Endpunkt mit erhaltener ID und Dauer; der Server erhält weitere vorhandene Eigenschaften. |
| Fehlgeschlagene Änderungen, Erledigungen oder Löschungen konnten Erfolg vortäuschen. | HTTP-Fehler werden ausgewertet. Eingaben bleiben erhalten; keine Erfolgsmeldung und keine Erledigungsdokumentation nach fehlgeschlagener Speicherung. |
| Abschlussarbeiten konnten scheitern, während der Lauf bereits als abgeschlossen erschien. | Abschlussstatus erst nach erfolgreichen Arbeiten; Fehler halten den Assistenten offen. Bereits erfolgte Teilschritte werden nicht als vollständiger Abschluss dargestellt. |
| Löschen eines gespeicherten Laufs nach fehlgeschlagener Bestandsabfrage gefährdete andere Zwischenstände. | Vor dem Löschen muss der Bestand erfolgreich geladen werden. Beim Fallbeginn werden zugehörige Uploads erst nach erfolgreichem Entfernen des Laufes bereinigt. |

Bei älteren Fallabschluss-Zwischenständen ohne Fall-ID muss der passende Fall bereits geöffnet sein. Der Assistent weist auf eine nicht passende Zuordnung hin. Die Speicherwarteschlange ist keine serverseitige Transaktion über mehrere Benutzer oder Browser hinweg. Bei einem Fehler während mehrerer Abschlussarbeiten können bereits erledigte Teilschritte bestehen bleiben.

## Prüfung

Geprüft wurde die tatsächliche ausgelieferte HTML-Anwendung mit synthetischen Daten und abgefangenen Serveraufrufen. Produktive Daten, echter E-Mail-Versand, externe KI-Dienste und Kalenderanbieter wurden nicht angesprochen. WebKit ist hier eine automatisierte Browserprüfung, kein Test einer realen Safari-Installation.

- **132 Desktop-Ablauf- und Layoutprüfungen:** jeweils 66 in Chromium und WebKit. Enthalten sind alle neun Fallbeginn- und acht Fallabschluss-Schritte, aktuelle Formularspeicherung, konkurrierende Speicheraufrufe, Fehler und Wiederholung, Fallwechsel, verspätete Antworten, Aufgaben- und Terminänderungen, Abschluss, Löschen, Dokumentauswahl, individuelle Editortexte, direkter Export und Checklisten.
- **110 mobile Ablaufprüfungen:** jeweils 55 in Chromium und WebKit. Damit sind auch die gemeinsamen Speicher-/Dokumentfunktionen, schmale Ansichten, Navigation, Tastaturzustand sowie der Rückwechsel zwischen Smartphone und Desktop abgedeckt.
- **30 Codetests:** Navigation, Scrollverhalten, Rechnungslegung, Fallzuordnung und Online-Fallladen. Die Syntaxprüfung umfasst alle 233 ausführbaren JavaScript-Blöcke.
- Desktopdarstellung mit 1100, 1280 und 1600 Pixeln Breite, hell und dunkel; der Dokumenteditor zusätzlich in beiden Farbschemata. Keine JavaScript-Laufzeitfehler in den Browserläufen.
- Die bestehenden eingebetteten Daten-/Vorlagenblöcke und das vorhandene NUL-Zeichen bleiben unverändert. Außerhalb der drei bearbeiteten Assistentenskripte und der beiden neuen Desktopblöcke gibt es gegenüber dem Ausgangsstand dieses Reviews keine inhaltlichen Änderungen an der HTML-Datei.

Prüfprogramm: `server/scripts/qa-desktop-case-wizard.cjs`. Es nutzt die vorhandene lokale Browser-Testumgebung. `PLAYWRIGHT_MODULE` setzt den Bibliothekspfad, `MOBILE_QA_BROWSER=webkit` wählt WebKit und `MOBILE_QA_OUTPUT` das Ausgabeverzeichnis.

[Chromium-Protokoll](desktop-fallassistenten-v1/pruefungen/desktop-chromium.txt) · [WebKit-Protokoll](desktop-fallassistenten-v1/pruefungen/desktop-webkit.txt) · [Mobile Chromium](desktop-fallassistenten-v1/pruefungen/mobile-chromium.txt) · [Mobile WebKit](desktop-fallassistenten-v1/pruefungen/mobile-webkit.txt) · [Codetests](desktop-fallassistenten-v1/pruefungen/code-tests.txt) · [Integrität](desktop-fallassistenten-v1/pruefungen/integritaet.json)
