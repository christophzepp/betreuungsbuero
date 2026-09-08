# Mobile Vermögensaufstellung

Stand: 07.09.2026. Umsetzung auf dem bestehenden Arbeitsstand des mobilen Umbaus, Release-Basis v0.7.7. Die Änderungen liegen lokal in `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html`.

[Galerie mit 13 tatsächlichen App-Ansichten](mobile-vermoegensaufstellung-v1/ansichten.html)

## Umfang

Die Vermögensaufstellung verwendet jetzt die gemeinsame mobile Kopfzeile, flache Positionslisten, vollständige Details, geschützte Formulare, Filterblätter und fest erreichbare Aktionen. Der vorhandene mobile Einstieg bleibt erhalten.

| Bereich | Mobile Funktionen |
| --- | --- |
| Anfang und Abschluss | Umschaltung zwischen beiden Ständen; jeweils Vermögen und Schulden; getrennte Summen und Nettovermögen. Die Summen stammen aus dem vollständigen gewählten Stand und bleiben unabhängig von Anzeige-Filtern. |
| Suche | Vollständiger Text aus Kategorie, Details, Institut, Wert und Herkunft; Eingabefokus bleibt beim Aktualisieren der Treffer erhalten. |
| Filter | Vermögen/Schulden/beides, Kategorie, Institut, Herkunft aus direkter Erfassung bzw. Import oder Schuldenregulierung; Sortierung nach Erfassung, Kategorie oder höchstem Wert. |
| Liste und Details | Sämtliche Positionen können nachgeladen werden. Details zeigen alle vier vorhandenen Datenfelder sowie Stand und Herkunft. Leere Beträge erscheinen als „Wert offen“. |
| Neuanlage | Vermögen oder Schulden, jeweils Anfang oder Abschluss; Kategorie mit vorhandenen Vorschlägen, Details, Institut mit Vorschlägen und Wert. |
| Bearbeiten | Dieselben vier vorhandenen Felder. Änderungen werden erst nach Speichern übernommen; Kennung, nicht bearbeitete Metadaten und der andere Stand bleiben erhalten. |
| Löschen | Ausdrückliche Bestätigung für genau die ausgewählte Position; zwischenzeitliche Änderungen werden vor dem Löschen geprüft. |
| Schuldenregulierung | Vorhandene Übernahme manueller Schulden mit Bestätigung. Forderung, bereits gezahlter Betrag und Anfangs-/Abschlussspiegelung bleiben erhalten. Gespiegelte Schulden bleiben schreibgeschützt. |
| Fallwechsel | Bestehende Fallauswahl; der Ladevorgang sperrt doppelte Bedienung. Schließen kehrt zum Ursprungsfall zurück. Bei bewusster Berichtsübergabe bleibt dagegen der ausgewählte Fall geöffnet. |
| Berichte | Vollständige vorhandene Übergabe an Jahresbericht mit Vermögenssorge und Rechnungslegung. Der Jahresbericht erhält Abschlusswerte, die Rechnungslegung Anfangs- und Endwerte sowie Verbindlichkeiten. |

Die vier bestehenden Arrays `begin`, `end`, `debtsBegin` und `debtsEnd` bleiben die Datenquelle. Gleiche Kennungen in unterschiedlichen Ständen werden getrennt behandelt. Vorhandene Excel-/Berichtsverknüpfungen und die ursprüngliche Schuldenübernahme werden weiterverwendet.

Das aktuelle Vermögensmodell hat vier Positionsfelder: Kategorie, Details, Institut und Wert. Stichtag und Beleg besitzen darin bislang keine eigenen Datenfelder; die beispielhaften Mockup-Angaben wurden deshalb nicht als Eingaben ohne Speicherung eingeführt. Die ursprüngliche Vermögensaufstellung enthält auch keinen eigenen PDF-/Excel-Exportknopf; die vorhandenen Ausgabewege über Stammdaten und Berichte bleiben bestehen.

## Eingabeschutz und Bedienung

Entwürfe bleiben bei Aktualisierung, Remote-Hinweisen, Chatwechsel und Größenwechsel erhalten. Verlassen mit Änderungen öffnet die gemeinsame Verwerfentscheidung. Vor Speichern werden Fall, Datenobjekt, Berechtigung und ursprüngliche Position geprüft. Bei einer zwischenzeitlichen Änderung bleibt der Entwurf lesbar; er überschreibt den neueren Stand nicht. Synchrone Speicherfehler stellen auch bei unvollständigen Altbeständen exakt die bisherigen Felder wieder her.

Der gemeinsame Chats-Zugang mit Mitarbeiterchat-Badge bleibt erreichbar. Abwärtsscrollen verbirgt die Navigation, Aufwärtsscrollen zeigt sie wieder; die gemeinsame Steuerung zeigt sie am Seitenanfang und beim Ansichtswechsel. Bei geöffneter Tastatur wird sie ausgeblendet, während die Formularaktionen oberhalb des verbleibenden Sichtbereichs bleiben. Der Desktop erhält weiterhin die vier ursprünglichen Tabellen und Berichtsschaltflächen; ein offener Entwurf bleibt beim Größenwechsel zunächst erhalten.

## Korrektur bei der Berichtsübernahme

Die Browserprüfung hat einen bestehenden Fehler in der Rechnungslegung aufgedeckt: Deren automatische Kontensumme suchte nach der ersten Kategorie mit „Bargeld“ oder „Bankguthaben“. Dadurch wurde eine gerade importierte Bargeldposition samt Beschreibung und Anfangs-/Endwert überschrieben, bei fehlenden Konten sogar mit null Euro.

Importierte Vermögenspositionen tragen jetzt eine Herkunftsmarkierung. Die automatische Berechnung aktualisiert ausschließlich die vorgesehene Kontensumme und erhält die importierten Einzelwerte. Die ursprüngliche Rundung und die automatische Berechnung des vorgesehenen Kontenpostens bleiben geprüft. Auch wiederholte Übernahmen erzeugen weiterhin keine Dubletten. Die bereits vorhandene additive Übernahmelogik bleibt bestehen; sie ist keine laufende Synchronisierung geänderter Positionen.

Zusätzlich kann die mobile Berichtsübergabe gezielt den Rücksprung des Vermögens-Fallwechslers aufheben. So wird beim Öffnen eines Berichts nicht parallel der Ursprungsfall geladen. Der normale Rücksprung beim Schließen und die Registrierung anderer Module bleiben erhalten.

## Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| Vermögensaufstellung im Browser | **46 erfolgreich**: alle vier Positionstypen, Summen, Suche/Filter, Entwürfe, Chat, Konflikte, Löschen, echte Schuldenübernahme, Fallwechsel, beide Berichtsübergaben, große Bestände, Navigation, Berechtigungen und Desktop-Rückkehr. |
| Rechnungslegung erneut im Browser | **49 erfolgreich**, einschließlich CSV-Dateiimport, Banking-Vorschau, Belegzuordnung und tatsächlicher PDF-Erzeugung. |
| Handkasse erneut im Browser | **42 erfolgreich**, einschließlich Serien, PDF-/XLSX-Ausgabe und Rechnungslegungsübernahme. |
| Darstellungen | Hell und dunkel bei 320, 360, 390 und 430 Pixeln ohne horizontalen Überlauf in den geprüften Listen; tatsächliche Formular-, Filter- und Berichtsansichten visuell geprüft. |
| Gezielte Tests | **197 bestanden**, darunter 12 neue Funktionstests für Vermögensdaten, Speichervorgänge, Konflikte, Fallrücksprung und die korrigierte Rechnungslegungsübernahme. Syntaxprüfung aller 229 ausführbaren JavaScript-Blöcke enthalten. |
| Vollständige Suite | **1.294 Tests: 1.290 bestanden, 3 bereits bekannte Fehler, 1 übersprungen**. |
| Dateiintegrität | 311 Scriptblöcke erhalten; alle 76 eingebetteten PDF- und 6 JSON-Blöcke bytegleich; ein vorhandenes NUL-Byte erhalten. Geändert wurden drei bestehende JavaScript-Blöcke und der mobile CSS-Block. Alle übrigen Bytes entsprechen dem Arbeitsstand zu Beginn dieser Umsetzung. |

Die drei Fehler betreffen unverändert die Backup-/Recovery-Registrierung von `office_ai_config.allowed_models` und den V230-PDF-Golden-Vergleich. [Nachweis am ursprünglichen Ausgangsstand](mobile-fundament-v1/baseline-fehler.txt). Die testbedingt erzeugte Golden-Datei wurde wiederhergestellt.

Alle Browserprüfungen verwenden die tatsächliche App mit synthetischen Fällen und abgefangenen Netzwerkantworten. Die Prüfungen decken die Bedienung und lokale Datenverarbeitung ab; ein echter Server-Fallwechsel, externe Dienste und eine physische iPhone-Tastatur sind damit nicht nachgewiesen. Es wurden keine Produktivdaten geändert.

## Nachweise

- [Vermögensaufstellung im Browser](mobile-vermoegensaufstellung-v1/browser.txt)
- [Rechnungslegung: Wiederholungsprüfung](mobile-vermoegensaufstellung-v1/rechnungslegung-regression.txt)
- [Handkasse: Wiederholungsprüfung](mobile-vermoegensaufstellung-v1/handkasse-regression.txt)
- [Gezielte Tests](mobile-vermoegensaufstellung-v1/gezielte-tests.txt)
- [Vollständige Testsuite](mobile-vermoegensaufstellung-v1/vollstaendige-testsuite.txt)
- [Bytevergleich und SHA-256](mobile-vermoegensaufstellung-v1/integritaet.json)
