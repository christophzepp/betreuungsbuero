# Mobiles Fahrtenbuch / Fahrtkostennachweis

Stand: 08.09.2026. Umsetzung auf dem vorhandenen mobilen Arbeitsstand nach den Bürofinanzen, Release-Basis v0.7.7. Die Änderungen liegen lokal in `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html`.

[Galerie mit 18 tatsächlichen App-Ansichten](mobile-fahrtenbuch-v1/ansichten.html)

## Oberfläche und Funktionsumfang

Das Modul verwendet die gemeinsame marineblaue Kopfzeile, Listen, eigene Detail- und Formularansichten, Filterblätter und fest erreichbare Aktionen. Die drei Bereiche sind **Fahrten**, **Nachweise** und **Fahrzeuge**. Chats einschließlich Mitarbeiterchat-Zugang bleiben Teil der gemeinsamen Navigation.

| Bereich | Mobile Funktionen |
| --- | --- |
| Fahrtenliste | Gruppierung nach Monat, vollständige Suche über Datum, Anlass, Fall, Fahrer, Fahrzeug und beide Adressen. Gesamtstrecke und gespeicherte Erstattung beziehen sich auf die aktuelle Auswahl. Große Bestände werden in Schritten von 60 Fahrten nachgeladen. |
| Fahrtenfilter | Jahr, Monat, Fahrzeug, Fall einschließlich „Ohne Fallzuordnung“, Status, Fahrer für berechtigte Prüfer und Sortierung nach Datum, Kilometern oder Erstattung. |
| Details | Datum, Anlass, Fall, Fahrername, Fahrzeug, vollständige Start-/Zieladresse, Kilometer, gespeicherte Erstattung, Status, Fahrerbestätigung, Prüfvermerk und vorhandene Änderungszeit. Lange Streckenangaben sind in der Liste als Vorschau und im Detail vollständig lesbar. |
| Fahrt erfassen/bearbeiten | Alle acht vorhandenen Felder: Fahrzeug, Fahrer, Datum, Fall, Fahranlass, Startadresse, Zieladresse und Kilometer. Bestehende archivierte Fallzuordnungen und nicht mehr in der Auswahl enthaltene Fahrer bleiben erhalten. |
| Streckenwerkzeuge | Bürostammadresse als Start oder Ziel, Adressvervollständigung, Entfernungsberechnung und Start-Ziel-Tausch über die vorhandenen Funktionen beziehungsweise Karten-Endpunkte. |
| Kalenderübernahme | Durchsuchbare Termine von 90 Tagen zurück bis 30 Tagen voraus; Datum, Anlass, Ziel und Fall werden in den Entwurf übernommen. Die mobile Auswahl enthält alle passenden geladenen Termine und übernimmt nicht die bisherige Begrenzung auf 40 Treffer. |
| Duplizieren | Vorbelegte neue Fahrt mit eigenem Datensatz. Vor dem Speichern lassen sich alle Felder bearbeiten und Start/Ziel vertauschen. Status und Bestätigungen der Quellfahrt werden nicht übernommen. |
| Status und Unterschriftsvermerke | Entwurf, Eingereicht, Geprüft, Genehmigt, Ausgezahlt und Abgelehnt nach den bestehenden Berechtigungen. Mitarbeitende bestätigen das Einreichen mit ihrem Namen. Der Server versieht die Freigabeschritte berechtigter Prüfer mit dem vorhandenen Prüfvermerk. |
| Mehrfachauswahl | Einzelne oder alle bearbeitbaren aktuellen Treffer auswählen, abwählen, Status ändern oder nach Bestätigung löschen. Verdeckte Treffer anderer Filter werden nicht mitgelöscht. |
| Fahrzeugverwaltung | Liste, Suche, Statusfilter, Detail, Neuanlage, Bearbeitung von Kennzeichen/Modell/Status/Anmerkung sowie bestätigte Löschung einschließlich zugehöriger Fahrten. Vorhandene Halterangaben sind im Detail lesbar. Direkter Sprung zu den Fahrten eines Fahrzeugs. |
| Nachweise | Jahr und Fahrzeug beziehungsweise Fahrer auswählen; Anzahl, Kilometer, Erstattung und Verteilung der Bearbeitungsstände anzeigen. Fahrzeugnachweise als PDF/Excel/ODS; Fahrernachweise über alle Fahrzeuge als Excel/ODS. |

Die Nachweise verwenden die ursprünglichen Fachgeneratoren und die tatsächliche Excel-Vorlage. Wie bisher umfasst ein Nachweis die sichtbaren Fahrten des gewählten Fahrzeugs oder Fahrers im gesamten ausgewählten Jahr. Suche und Filter der Fahrtenliste grenzen diese Jahresnachweise nicht ein; dieser Umfang wird in der Nachweisansicht ausdrücklich erklärt.

Die vorhandene Funktion zur Bereitstellung der Fahrten- und Fahrzeugdaten für die Gesamtsicherung bleibt erhalten. Es wurde kein zusätzlicher Einzel-CSV-Export erfunden.

## Übereinstimmung mit dem Mockup und dem Datenmodell

Der Aufbau folgt dem freigegebenen mobilen Stil. Zusätzlich erhält die bestehende Fahrzeugverwaltung einen eigenen Bereich, damit sie auf dem Smartphone vollständig bedienbar bleibt.

Das echte Modell speichert eine **Gesamtstrecke**. Die beispielhaften Mockup-Felder für einfache Strecke, Hin-/Rückfahrt und frei editierbaren Kilometersatz wurden nicht als neue Datenfelder eingeführt. Stattdessen bleiben Gesamtstrecke, Duplizieren und Start-Ziel-Tausch verfügbar. Der Server ermittelt die Erstattung nach dem vorhandenen Satz; die Listen zeigen die gespeicherten Beträge. Lokal bleibt der bestehende Pauschalsatz Grundlage. Eine reine Änderung des Anlasses setzt lokal einen vorhandenen historischen Erstattungsbetrag nicht mehr zurück.

## Eingabeschutz und Berechtigungen

- Ungespeicherte Eingaben bleiben bei Hintergrundereignissen, Chatwechsel und Breitenwechsel erhalten. Beim Verlassen fragt die gemeinsame mobile Oberfläche nach. Bereits auf dem Desktop begonnene Fahrten werden ins mobile Formular übernommen.
- Schreibvorgänge sperren Mehrfachbedienung und Verlassen. Fehler lassen das Formular mit den Eingaben offen.
- Vor Änderungen und Löschungen wird der aktuelle Datensatz mit dem Ausgangsstand verglichen. Erkennbare zwischenzeitliche Änderungen werden nicht überschrieben. Diese clientseitige Vorprüfung ersetzt keine atomare Versionsprüfung des Servers; Änderungen zwischen Prüfung und Schreibzugriff bleiben eine Grenze.
- Bei teilweise fehlgeschlagenen Sammelstatusänderungen werden Erfolge und verbleibende Fahrten angezeigt. Ein erneuter Speicherversuch bearbeitet nur die offenen Fahrten. Sammellöschungen melden ebenfalls die tatsächlich erfolgten Löschungen.
- Fahrten und Fahrzeuge werden gemeinsam geladen; eine verspätete ältere Antwort ersetzt keinen neueren Stand. Bei einem Abruffehler bleiben die letzten Daten mit Fehlermeldung sichtbar. Nicht verfügbare Fahrer- oder Fallauswahlen werden gesperrt, ihre Werte beim Speichern ausgelassen und vorhandene Zuordnungen dadurch erhalten.
- Verspätete Adress- und Routenantworten überschreiben keine inzwischen manuell geänderten Eingaben und kein anderes Formular.
- Mitarbeitende können eigene ungeprüfte Fahrten bearbeiten. Das bestehende delegierte Recht `canApproveMileage` wird auch in der neuen Oberfläche berücksichtigt. Fahrzeugverwaltung bleibt an Eigentum beziehungsweise Administratorrechte gebunden. Der vorhandene Schreibschutz gilt zusätzlich.
- Die Navigation blendet sich beim Abwärtsscrollen aus und beim Aufwärtsscrollen wieder ein; am Anfang und bei neuen Ansichten ist sie erreichbar. Bei geöffneter Tastatur wird sie ausgeblendet, während die Formularaktionen am sichtbaren Bildschirmbereich bleiben.

Die ursprünglichen Desktoptabellen, Downloadmenüs und öffentlichen Schnittstellen für Übersicht, Kalender und Gesamtsicherung bleiben vorhanden. Die lokale Speicherung verwendet weiterhin `bueroLocal.mileageTrips` und `bueroLocal.mileageVehicles` mit dem bestehenden Speicherweg; ein lokaler Speicherfehler stellt den vorherigen Bestand wieder her.

## Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| Browserabläufe | **55 bestanden**, darunter sämtliche Formulare, Kalenderübernahme, Routenwerkzeuge, Duplizieren, Einreichen, delegierte Freigabe, Fahrzeugverwaltung, Teilfehler bei Sammelaktionen, Löschbestätigungen, Rechte, Entwurfsschutz und Desktopwechsel. |
| Darstellung | Hell/dunkel bei 320, 360, 390 und 430 Pixeln ohne horizontalen Überlauf in der Fahrtenliste; alle Kopfaktionen bleiben erreichbar. Details, Filter, Streckenwerkzeuge, Nachweise und Formulare zusätzlich visuell kontrolliert. |
| Exporte | Alle fünf bestehenden Exportwege im Browser tatsächlich ausgeführt. Fahrzeug-PDF, -XLSX und -ODS als synthetische Prüfnachweise gespeichert; XLSX/ODS zusätzlich auf gültige Archivstruktur und tatsächlichen Fahrtinhalt geprüft. |
| Gezielte Tests | **216 bestanden**, einschließlich 22 neuer Funktionstests, bestehender Fahrtenauswahl-/Downloadprüfungen, der übrigen mobilen Tests und Syntaxprüfung aller 229 ausführbaren Scriptblöcke. Nach den abschließenden Anpassungen erneut ausgeführt. |
| Vollständige Suite | **1.358 Tests: 1.354 bestanden, 3 bereits bekannte Fehler, 1 übersprungen.** Abschließende Darstellungs- und Größenwechselanpassungen wurden danach mit den Browserabläufen und gezielten Tests erneut geprüft. |
| Integrität | 311 Scriptblöcke, sämtliche 82 eingebetteten Datenblöcke und das vorhandene NUL-Byte erhalten. Änderungen betreffen nur `mileage-script-v1` und den bestehenden mobilen CSS-Block. Alle übrigen Bytes entsprechen dem Arbeitsstand zu Beginn dieser Umsetzung. |

Die drei bekannten Suite-Fehler betreffen die Backup-/Recovery-Registrierung von `office_ai_config.allowed_models` und den V230-PDF-Golden-Vergleich. [Nachweis am ursprünglichen Ausgangsstand](mobile-fundament-v1/baseline-fehler.txt). Die testbedingt veränderte PDF-Golden-Datei wurde wiederhergestellt.

Die Browserprüfung verwendet die tatsächliche App mit synthetischen Fahrten und abgefangenen Server- und Kartenantworten. Die Datei- und Vorlagenverarbeitung läuft tatsächlich. Externe Kartendienste, produktive Serverzugriffe und eine physische iPhone-Tastatur wurden nicht geprüft. Es wurden keine Produktivdaten geändert und keine Änderungen veröffentlicht.

## Nachweise

- [Browserprüfung](mobile-fahrtenbuch-v1/browser.txt)
- [Gezielte Tests](mobile-fahrtenbuch-v1/gezielte-tests.txt)
- [Vollständige Testsuite](mobile-fahrtenbuch-v1/vollstaendige-testsuite.txt)
- [Dateiprüfung](mobile-fahrtenbuch-v1/dateipruefung.txt)
- [Bytevergleich und SHA-256](mobile-fahrtenbuch-v1/integritaet.json)
- Synthetischer Fahrzeugnachweis: [PDF](mobile-fahrtenbuch-v1/nachweis-fahrzeug.pdf), [Excel](mobile-fahrtenbuch-v1/nachweis-fahrzeug.xlsx), [ODS](mobile-fahrtenbuch-v1/nachweis-fahrzeug.ods)
