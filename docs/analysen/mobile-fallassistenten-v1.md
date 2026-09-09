# Mobile Fallassistenten: Fallbeginn und Fallabschluss

Lokaler Arbeitsstand vom 9. September 2026. Die Umsetzung baut auf der bereits lokal ergänzten mobilen Fallorganisation auf. Zusammen mit der Desktop-Überarbeitung für Beta am 9. September 2026 freigegeben.

[Ansichten der implementierten Anwendung](mobile-fallassistenten-v1/index.html)

## Bedienung

Fallbeginn und Fallabschluss sind im mobilen Mehr-Menü freigegeben und wie die übrigen Module sortier- und anheftbar. Damit umfasst die mobile Menüübersicht 37 Bereiche.

Die vorhandenen Assistenten behalten ihre geführten Abläufe. Eine kompakte Kopfzeile zeigt den Assistenten und Fallkontext. Darunter öffnet „Schritt … von …“ eine Schrittauswahl mit den bisherigen Freigaben und Sperren. Zurück und Weiter bleiben am unteren Rand erreichbar. Die Hauptnavigation blendet sich beim Scrollen richtungsabhängig aus und ein; bei geöffneter Bildschirmtastatur bleibt sie verborgen. Der Inhalt nutzt den dadurch frei werdenden Platz.

| Assistent | Erhaltene Schritte und Funktionen |
| --- | --- |
| Fallbeginn | Basisdaten und Ziel der Übernahme; mehrere Quelldateien; Texterkennung; KI-Analyse; strukturierte Prüfung und Übernahme; anpassbare Ordnerstruktur; Sicherung der Unterlagen; Dokumentplanung mit Erstellung und Versand; Abschluss. |
| Fallabschluss | Abschlussgrund und Datum; offene Vorgänge prüfen, bearbeiten, erledigen oder bewusst bestätigen; Schlussbericht und Schlussrechnung beziehungsweise Entlastung; Herausgabe samt Empfängerangaben; Übergabepaket; weitere Schlussdokumente; Archivierung; Zusammenfassung und Abschluss. |

Eingabefelder, Uploads, fachliche Prüfungen, Bestätigungen und die bestehenden Speicher-/Exportfunktionen werden weiterverwendet. Tabellen werden auf schmalen Bildschirmen zu beschrifteten Einträgen. Die Aktionen offener Vorgänge umbrechen in ausreichend große Schaltflächen. Der eingebettete Ordnergenerator bietet neben den Pfeilen eine Zielauswahl zum Verschieben ohne Drag-and-drop.

## Dokumentseiten

Die langen Reihen aufgeklappter Editoren werden mobil durch einen Dokumentplan ersetzt:

- Suche nach Dokument/Empfänger und Statusfilter; bei Schlussdokumenten zusätzlich der Status „Erstellt“.
- Hinweise und vorhandene Abschlusschecklisten sind einklappbar. Die Bestätigungen bleiben erhalten und aktualisieren den Status in der Liste.
- „Dokument ergänzen“ öffnet ein eigenes Eingabeblatt für Titel, Empfänger und Stichpunkte.
- Ein ausgewähltes Dokument zeigt seine bisherigen Aktionen: Editor, Export/Versand, Vorschlag und KI-Werkzeuge sowie die Fortschrittsmarkierungen.
- Der Editor nutzt die vorhandene mobile Dokumentansicht. Die Schlussrechnungslegung nutzt ihren eigenen mobilen Ablauf.
- „Alle Dokumente“ und die Dokumentauswahl führen im selben Assistenten weiter. Suche und Filter bleiben während dieser Navigation erhalten.
- Jedes bearbeitete Dokument erhält einen eigenen gespeicherten Editorstand einschließlich Anlagen. Unterschiedliche Schreiben auf Basis derselben Freidokument-Vorlage vermischen ihre Inhalte dadurch nicht. Der individuelle Stand wird auch beim Wechsel zwischen Smartphone und Desktop berücksichtigt.

Das Öffnen des Exportdialogs wird als „Export geöffnet“ angezeigt; eine Versandbestätigung bleibt eine ausdrückliche Fortschrittsmarkierung. Der bestehende KI-Sammelentwurf und die zusätzliche Bankencheckliste im Fallbeginn bleiben erreichbar.

## Begleitkorrekturen

- Zwischenstände übernehmen auch Eingaben auf der aktuellen mobilen Seite, ohne erst „Weiter“ zu verlangen.
- Beim Verlassen über die Hauptnavigation wird der Zwischenstand gespeichert. Schlägt das Speichern fehl, bleibt der Assistent mit den Eingaben geöffnet.
- Fehlgeschlagenes Laden bestehender Läufe wird beim Speichern nicht als leere Liste behandelt. Der Fallabschluss prüft nun ebenfalls HTTP-Fehler beim Speichern.
- Das Fortsetzen erhält auch die späteren Schritte: Fallbeginn bis Schritt 9, Fallabschluss bis Schritt 8. Zuvor wurden gespeicherte Schritte auf einen früheren Schritt begrenzt.
- „Weiter: Archivierung“ im Fallabschluss ruft den erreichbaren Navigationshandler auf; zuvor verwies der Inline-Handler auf private Funktionen/Variablen.
- Der Dokumentwechsel setzt die mobile Auswahlansicht korrekt zurück und gibt die Schrittleiste wieder frei.
- Die eingebetteten Editoren stellen ihre ursprünglichen DOM-Knoten beim Verlassen wieder her. Vorbereitete Texte werden auch beim direkten mobilen Export dem gewählten Dokument zugeordnet.

## Prüfung

Prüfung der ausgelieferten HTML-Datei mit synthetischen Daten und abgefangenen Serveraufrufen. Kein physisches iPhone und kein echter Datenbank-, Mail- oder KI-Server wurden verwendet.

- 110 neue Ablaufprüfungen (je 55 in Chromium und WebKit): alle 9 beziehungsweise 8 Schritte, Schrittfreigaben, Datei-Upload, aktueller Zwischenstand, späte Schritte fortsetzen, Dokumente ergänzen und filtern, mehrere individuelle Texte, ausdrücklicher Vorschlag, direkter Export, Schlussbericht und Schlussrechnung, Abschlusscheckliste, Speicher-/Ladefehler, Navigation und Verschieben im Ordnerplan.
- 320, 390 und 570 Pixel Breite, helle/dunkle Darstellung, simulierte Bildschirmtastatur, Aus-/Einblenden der Navigation sowie Rückwechsel zum Desktop.
- Bestehende Editorprüfung: 290 Prüfungen, darunter Inventar der Eingabeelemente in 89 Dokumenttypen, Tabellen, Anlagen, tatsächliche PDF-Vorschau, Export, Chat-Rückkehr und Wiederherstellung adoptierter Knoten.
- Bestehende mobile Menüprüfung: 105 Prüfungen einschließlich gespeicherter Favoriten, Start-/Chats-Sortierung und Mitarbeiterchat-Badge.
- Bestehende Fallorganisationsprüfung: 68 Prüfungen einschließlich Ordneroperationen, Fall-/Archivabläufen, Rechten und Speicherfehlern.
- 30 automatisierte Tests für Navigation, Scrollverhalten, Rechnungslegung, Fallzuordnung und Online-Fallladen. Alle 232 ausführbaren JavaScript-Blöcke werden syntaktisch geprüft.

Prüfprogramme: `server/scripts/qa-mobile-case-wizard.cjs`, `qa-mobile-document-editor.cjs`, `qa-mobile-menu.cjs` und `qa-mobile-case-organization.cjs`. `PLAYWRIGHT_MODULE` verweist auf die installierte Bibliothek; `MOBILE_QA_BROWSER=webkit` wählt WebKit, `MOBILE_QA_OUTPUT` das Ausgabeverzeichnis. Die Protokolle stehen im Unterordner `mobile-fallassistenten-v1/pruefungen/`.

307 Script-/Datenblöcke sind gegenüber dem lokalen Ausgangsstand dieses Arbeitsschritts unverändert. Alle eingebetteten Daten-/Vorlagenblöcke und das vorhandene NUL-Zeichen bleiben erhalten. Die Desktop-Assistenten wurden anschließend ebenfalls überarbeitet; siehe [Desktop-Review](desktop-fallassistenten-v1.md). Die gemeinsamen Korrekturen für Zwischenstände und Dokumentinhalte gelten in beiden Ansichten.
