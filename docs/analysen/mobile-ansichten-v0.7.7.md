# Kartierung der mobilen Ansichten – Betreuungsbüro v0.7.7

Stand: 6. September 2026. **32 Bereiche in der mobilen Hauptnavigation, 30 Schnellaktionen sowie weitere gemeinsame Bausteine und fachliche Querverbindungen.**

## Geprüfter Stand und Freischaltbedingungen

Das Repository `christophzepp/betreuungsbuero` wurde mit `git fetch origin --prune --tags` von GitHub aktualisiert. `origin/main`, das neueste Stable-Tag `v0.7.7` und der lokale `HEAD` zeigen auf **`9b28c434343743b116da66f37cb88d0b7cbc2019`**, Commit-Datum **06.09.2026, 22:11:26 MESZ**. Ein separater Remote-Branch `stable` ist nicht vorhanden. Der Arbeitsbranch `develop` war bereits inhaltsgleich; ein Branchwechsel war nicht erforderlich.

Grundlage sind die ausgelieferte HTML-App, ihre Mobil-Registry, CSS/Zustandssteuerung, Modulöffner, Schnellaktionen und vorhandene Prüfungen. Die vier Screenshots dienen als visuelle Referenz. Die App wurde für diese Kartierung nicht geändert. Das tatsächlich auf dem Server laufende Container-Image und die Berechtigungen eines konkreten Kontos wurden nicht abgefragt.

Die Smartphone-Oberfläche wird aktiviert, wenn alle folgenden Bedingungen erfüllt sind:

- Browserkennung iPhone/iPod oder Android **mit** `Mobile`.
- Fensterbreite höchstens 1024 CSS-Pixel.
- Anmeldung/Start bereit: Login-Overlay geschlossen und Startseite oder Arbeitsbereich sichtbar.
- Kein iPad/iPadOS; diese Geräte werden ausdrücklich ausgeschlossen.

Ein schmales Desktopfenster allein aktiviert das System nicht. Die Klasse `html.mobile-online-active` schaltet die Mobilregeln ein. Der Name „mobile-online“ und der Text im Benutzermenü beziehen sich auf die Online-Sitzung; **die Aktivierungsfunktion selbst prüft jedoch nicht `__appMode === 'online'`**. Geräteprofil, Betriebsart und Rechte sind getrennte Kriterien.

„Freigeschaltet“ bedeutet in dieser Kartierung: im mobilen Navigationsangebot enthalten oder über einen mobilen Einstieg im Code verlinkt. Es bedeutet nicht, dass jedes Konto jede Aktion ausführen darf. Die Renderfunktionen der Mobil-Registry filtern lediglich `online-forms` aus; sie enthalten keine eigene rollenabhängige Filterung. Fachrechte, Fallzugriff, Serverprüfungen und eingerichtete Dienste können die Nutzung begrenzen. Beispielsweise trennt Banking Leserechte, Verbindungsverwaltung und Zahlungsrechte.

Quelle: [Mobil-Erkennung und Registry](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128565); [Stable-Release-Notiz](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/docs/releases/v0.7.7.md).

## Die neue Dokumentation als Referenz

Die vier Screenshots entsprechen den vier Ebenen der Implementierung. Dieselbe Modulwurzel wird abhängig vom Zustand anders dargestellt; mobil entsteht keine zweite Datenhaltung.

| Ebene | Bedienkonzept und Bausteine | Umsetzung |
| --- | --- | --- |
| Liste | Dunkler Kopf mit Modul-/Fallname; Fallwechsel; Suche, Kalender und Filter mit Aktiv-Zähler; Wochenstreifen, Heute und Monatsansicht; aktive Filterchips; Trefferzahl/Sortierung; Monatsgruppen; runder Plusknopf. | `fd-mobil-liste`, `.fd-m-top`, `.fd-strip`, `.fd-list`, `#dokuListBody`, `.fd-fab` |
| Lesen | Aktenseite mit Zurück, vorherigem/nächstem Eintrag und Positionszähler; Datum/Kontaktart, Einordnung, Inhalt, Rohnotiz, Anlagen und Excel-Zeile; unten Bearbeiten/PDF/Löschen, bei Anlagen zusätzlich Download. | `fd-mobil-lesen`, `.fd-read`, `.fd-m-bar` |
| Neu/Bearbeiten | Formularebene mit Zurück und Bearbeitungsstatus; einspaltige Abschnitte; Inhalt scrollt, Kopf und Speichern/Abbrechen stehen als getrennte Rahmenbereiche. | `fd-mobil-form`, `.fd-form`, `.fd-form-b`, `.fd-form-f` |
| Filterblatt | Abgedunkelter Hintergrund; Blatt von unten mit Griff, Zurücksetzen, Auswahlchips, fünf Eingrenzungen und Trefferzahl im Anwenden-Knopf. | `fd-m-sheet`, `.fd-sheet`, `.fd-sheet-in` |

Die Filterchips heißen **Alle, Von Hand, Automatisch, Planung, Persönliche Kontakte, Mit Anlagen, Für Berichte**. Die Eingrenzungen sind **Jahr, Bereich (Gegenüber), Themenfeld, Kontaktart und Quelle**.

Das Formular enthält: Fall; Datum/Kontaktart; Bereich/Gegenüber/Themenfeld/Vorgang; Inhalt; interne Rohnotiz; Regel- und KI-Vorschlag mit Übernahme; Foto, Datei und Aufnahme; Anlagenübersicht; Berichtsrelevanz mit Thema/Zielfeld; live aktualisierte Excel-Zeile. In der Leseansicht werden Bilder, Audio, Video und Dokumente getrennt angezeigt und können geöffnet, wiedergegeben oder heruntergeladen werden.

Die wesentlichen Konstruktionsentscheidungen:

1. **Ein Arbeitszustand pro Bildschirm.** Liste, Lesen und Formular ersetzen einander innerhalb derselben `.fd-shell`. Die Desktop-Dreispaltigkeit wird mobil aufgelöst.
2. **Gemeinsame Daten und Formularkomponente.** `fdState` hält Auswahl, Kalender und Bearbeitung. Die Filter nutzen denselben Filterzustand wie am Desktop. Das Formular funktioniert im Lesebereich und als eigener Dialog; sein Tippstand wird bei einem Neuaufbau berücksichtigt.
3. **Gezielte Sichtbarkeit.** Suche/Fallwechsel klappen bei Bedarf auf. Die Filterfelder werden zwischen Schiene und Blatt umgesetzt, sodass keine doppelten Feld-IDs entstehen.
4. **Ein maßgeblicher Inhaltsscroller je Ebene.** Kopf und Aktionsleisten stehen außerhalb des Scrollers. Die Formularfußleiste ist Teil des Flex-Rahmens und überlagert den Inhalt nicht bloß als schwebende Leiste.
5. **Größere primäre Touchflächen.** Formularfelder und Hauptknöpfe: 44 px; Kopf-Icons: 42 px; Plusknopf: 52 px; Leseaktionen: mindestens 52 px. Nebenlinks und Filterchips sind teilweise kleiner – eine einheitliche 44-px-Regel für alle Elemente existiert noch nicht.
6. **Rückwege und Bearbeitungszustand.** Zurück führt zur Liste; Blättern folgt der gefilterten Liste. Für bestimmte Wechsel und Abbrechen bei ungespeicherten Änderungen besteht eine Schutzabfrage.
7. **Vorhandene Fachintegration.** Datum, Fallbezug, automatische Einträge, Excel-Abbildung und Anlagen verwenden die bestehenden Fachfunktionen.

Details für eine spätere Übertragung: Filteränderungen wirken bereits während der Auswahl; **„Anwenden“ schließt das Blatt**. Der sichtbare Griff hat in diesem Modul keine eigene Zieh-/Wischsteuerung. Das Desktop-Menü **„Exportieren“ ist im mobilen Kopf verborgen**; der Einzel-PDF-Export bleibt in der Leseansicht erreichbar. Die neue Mobilebene bildet daher nicht jede Desktop-Schaltfläche ab.

Quellen: [Mobile Zustandssteuerung](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:34100), [Formularbaustein](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:33740), [Modulrahmen](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:33251), [Mobile Gestaltung](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:123937).

## Alle 32 Hauptbereiche

Standardleiste: **KI-Chat · Übersicht · Doku · E-Mail · Mehr**. Im Mehr-Menü sind alle 32 Bereiche enthalten, auch die angehefteten. Bis zu acht Favoriten plus „Mehr“ sind möglich. Reihenfolge und Favoriten sind anpassbar; die Vorschau unterstützt Ziehen mit Finger oder Maus. Präferenzen werden lokal zwischengespeichert und über `/api/user-prefs/mobile-navigation` synchronisiert.

Verteilung: **2 Seiten, 6 eigene Layouts, 22 gemeinsame Modulprofile, 1 eigenständige Vollansicht und 1 Menüblatt**. „Eigenes Layout“ entspricht der technischen Kennzeichnung `bespoke`; das ist kein Qualitätsurteil und keine Zusicherung, dass bereits das neue Dokumentationskonzept verwendet wird. Die folgende Reihenfolge ist die voreingestellte Reihenfolge des mobilen Menüs.

| Nr. | Menü/Modul | Mobile Bauweise | Ansichten und Bausteine |
| --- | --- | --- | --- |
| 1 | [Start](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128699) | Seite | Tagesübersicht; Dieser Fall/Alle Fälle; Fallauswahl; Schnellaktionen. |
| 2 | [KI-Fallchat](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128700) | Eigenes Layout | Unterhaltungen, einblendbare Seitenleiste, Chatverlauf, Eingabe und Anlagen. |
| 3 | [Stammdaten](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128702) | Seite | Personen-, Kontakt- und Betreuungsdaten; Karten; Kontaktdaten und soziales Netzwerk bearbeiten. |
| 4 | [Fallübersicht](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128701) | Eigenes Layout | Mobile Reiter Liste, Wiedervorlagen und Schnellaktionen; Fallauswahl, Filter und Details. |
| 5 | [Falldokumentation](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128704) | Eigenes Layout | Liste, Lesen, Neu/Bearbeiten, Filterblatt; Wochen-/Monatskalender; Medien und Excel-Zeile. |
| 6 | [Kalender](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128705) | Gemeinsames Modulprofil | Monat, Woche, Tag, Liste; Kalenderauswahl, Ansichtsmenü und ganzseitige Terminmaske. |
| 7 | [Aufgaben](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128706) | Gemeinsames Modulprofil | Aufgabenliste, Filter, Zeilenaktionen, eigener Editor und Anlagen. |
| 8 | [Fristen](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128707) | Gemeinsames Modulprofil | Fristenliste, Filter, eigener Editor und Vergütungsfristen. |
| 9 | [Wiedervorlagen](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128703) | Eigenes Layout | Wiedervorlagen der Fallübersicht; anlegen, bearbeiten, verlängern und abschließen. |
| 10 | [Adressbuch](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128708) | Gemeinsames Modulprofil | Kontaktliste, Suche, aufklappbare Filter, Kontaktkarten und Editor; Import/Export. |
| 11 | [E-Mail](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128709) | Eigenes Layout | Postfächer/Ordner, Nachrichtenliste, Lesen, Verfassen/Antworten und Anlagen. |
| 12 | [Datei-Explorer](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128710) | Eigenes Layout | Liste/Kacheln, Suche, Ordnerbaum-Overlay, Kontextmenü, Upload und Datei-/PDF-Leseansicht. |
| 13 | [Archivierte Formulare](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128735) | Gemeinsames Modulprofil | Gespeicherte Formulare/Berichtsfassungen; Filter und Datensatzaktionen. |
| 14 | [Export- und Versandhistorie](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128736) | Gemeinsames Modulprofil | Export-/Versandverlauf; Filter, Details und dateibezogene Aktionen. |
| 15 | [Banking](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128715) | Gemeinsames Modulprofil | Konten, Umsätze, Filter, Zahlungsaufträge und wiederkehrende Zahlungen. |
| 16 | [Handkasse](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128711) | Gemeinsames Modulprofil | Fall/Jahr, Buchungskarten, Saldo; neue Buchung, PDF, Excel und Rechnungslegung. |
| 17 | [Vermögensaufstellung](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128712) | Gemeinsames Modulprofil | Anfangs-/Abschlussvermögen; Schulden Anfang/Ende; Positionen und Berichtsanbindung. |
| 18 | [Lebensunterhalt](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128713) | Gemeinsames Modulprofil | Einnahmen/Ausgaben, Monatsbilanz, Dokumentenanalyse und Übernahmevorschläge. |
| 19 | [Schuldenregulierung](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128714) | Gemeinsames Modulprofil | Forderungen, Gläubiger, Raten, Zahlungen, Schuldeditor und Dokumentenauswertung. |
| 20 | [Gesundheit](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128716) | Gemeinsames Modulprofil | Allgemeines, Diagnosen, Medikation, Arzttermine, Klinik/Pflege, Eingriffe, Behandler, Notfallkontakte und Verfügungen. |
| 21 | [Wohnen](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128717) | Gemeinsames Modulprofil | Verlauf, Adressen, Wohnkosten; Untereditoren für Wohnsicherheit, Barrierefreiheit, Probleme und Unterstützung. |
| 22 | [Fähigkeiten & Alltag](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128718) | Eigenständige Vollansicht | Bereichsübersicht und ganzseitige Lese-/Bearbeitungsansicht; eigenständiges Overlay. |
| 23 | [Wünsche und Bedarfe](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128719) | Gemeinsames Modulprofil | Wünsche, Ziele, Bedarfe, Maßnahmen, Entscheidungen, Überprüfungen; Karten, Details und Editor. |
| 24 | [Genehmigungen](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128720) | Gemeinsames Modulprofil | Genehmigungsliste, Antrags-/Entscheidungsdaten und fokussierte Neuanlage. |
| 25 | [Kontaktmonitor](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128721) | Gemeinsames Modulprofil | Kontaktübersicht, Fälligkeiten, Filter, Exporte und ausklappbare Kontakterfassung. |
| 26 | [Betreuungsübersicht](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128722) | Gemeinsames Modulprofil | Aktuelle Fälle/Archiv, Fallkarten und Meldeangaben. |
| 27 | [Posteingang](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128723) | Gemeinsames Modulprofil | Tagesbezogener Dokumenten-Posteingang; Suche/Filter, Upload, KI und Bearbeitungsaktionen. |
| 28 | [Finanzen](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128725) | Gemeinsames Modulprofil | Laufende/einmalige Büro-Posten, Bilanz, Editor; Export, Buchhaltung und Bürokonten. |
| 29 | [Ausgangsrechnungen](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128726) | Gemeinsames Modulprofil | Ausgangsrechnungsliste, Aktionen/Exporte und ganzseitige Neu-/Bearbeitungsmaske. |
| 30 | [Fahrtkosten](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128727) | Gemeinsames Modulprofil | Fahrtkarten, Filter, Nachweis und ganzseitige Fahrtmaske mit Strecke/Kilometern. |
| 31 | [Qualifikationsmanager](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128728) | Gemeinsames Modulprofil | Personen als Karten, Personenfilter und Qualifikations-/Nachweisdetails. |
| 32 | [Benutzermenü](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128737) | Menüblatt | Menüblatt mit aktuellem Fall, Hell-/Dunkel-Wechsel und Abmelden. |

IDs, Öffner, DOM-Wurzeln, Profile und Quellzeilen stehen zusätzlich im [maschinenlesbaren Inventar](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/docs/analysen/mobile-inventar-v0.7.7.json).

## Alle 30 Schnellaktionen

Die mobile Startseite übernimmt das Schnellaktionsraster der Fallübersicht. Einige Aktionen öffnen kleine Erfassungsmasken, andere führen in ein Fachmodul. Bei „Alle Fälle“ werden die fallbezogenen Schnellaktionen in der Fallübersicht deaktiviert.

| Gruppe | Vollständige Auswahl |
| --- | --- |
| Sofort erfassen | Notiz; Aufnahme; Anlage; Transkript |
| Planen & Termine | Wiedervorlage; Termin; Aufgabe; Frist; Planung |
| Kontakt & Post | E-Mail / Post; Kontakt |
| Geld & Vermögen | Handkasse; Überweisung; Banking; Vermögen; Lebensunterhalt; Schulden; Vergütung; Fahrt |
| Betreuung & Gesundheit | Gesundheit; Fallverlauf; Fähigkeiten; Wohnen |
| Berichte & Gericht sowie Dokumentation | Bericht / Formular; Rechnungslegung; Betreuungsübersicht; Genehmigung; Dokument; Dokumentation; Fallchronik |

Der obere Startblock besitzt außerdem fünf Kennzahlen und fünf direkte Schnellzugriffe: Termine/Kalender, Aufgaben, Fristen, Wiedervorlagen und E-Mails. Der Umschalter „Dieser Fall / Alle Fälle“ begrenzt die Tagesübersicht. Dieser Block ist **nicht das separat konfigurierbare Desktop-Dashboard**.

Quellen: [Schnellaktionsraster](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:111952), [Übernahme auf Start](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128652), [Tagesübersicht](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:134398).

## Zusätzliche mobil verlinkte Bereiche ohne eigenen Mehr-Menü-Eintrag

Die Mobil-Registry ist keine appweite Zugriffssperre. Ihre Liste alleine beschreibt deshalb nicht die gesamte mobile Oberfläche.

| Zugang | Zusätzlich verlinkte Ansicht/Funktion |
| --- | --- |
| Schnellaktionen → Bericht / Formular | Anfangsbericht; Jahresbericht mit Vermögenssorge; Jahresbericht ohne Vermögenssorge; Schlussbericht; Freidokument |
| Schnellaktionen → Rechnungslegung | Rechnungslegungseditor |
| Schnellaktionen → Vergütung | Ausgangsrechnungserfassung und Öffnen der Ausgangsrechnungen; der aktuelle Dialog ist auf diesen Ablauf umgestellt |
| Schnellaktionen → Fallverlauf | Fallbeginn und Fallabschluss |
| Schnellaktionen → Dokument | Kurzentwurf/Freidokument und Öffnen des Freidokument-Editors |
| Wünsche und Bedarfe → verknüpftes Modul „Dokumente“ | Ordnergenerator, sofern ein entsprechender Modul-Link am Planungseintrag hinterlegt ist |
| Schnellaktionen → Fallchronik | Datei-Explorer im Ordner Betreuungsführung/Falldokumentation |
| Schnellaktionen → E-Mail / Post | Verfassen in separatem Browserfenster oder Posteingang |
| Finanzen | Detailliste/Buchhaltung und Bürokonten/Banking |
| Handkasse/Vermögensaufstellung und Fachverknüpfungen | Übergabe an und Öffnen von Berichten/Rechnungslegung |
| Archiv/Versandhistorie und Datei-/Medienaktionen | Datensatzabhängige Vorschauen, Downloads und weitere Dialoge |

Das sind vorhandene Ausgänge im Code, keine Zusicherung eines vollständig optimierten Layouts oder einer erfolgreichen Ausführung mit jedem Konto. Berichts- und Fallorganisationsmasken besitzen keinen eigenen Eintrag in der Mobil-Registry. Der dortige Kommentar bezeichnet Berichte, Ordnergenerator und Fallorganisation als Desktop-Arbeit; Schnellaktionen und Verknüpfungen aus Fachmodulen verlinken sie dennoch. Diese Abweichung gehört zum tatsächlichen Bestand. Die alten Schnellaktions-Handler für Ordnergenerator und Vergütungsantrag existieren noch; der aktuelle Dokument-/Vergütungsdialog bietet diese alten Ausgänge jedoch nicht mehr an. Ein vorhandener Handler allein zählt hier nicht als sichtbarer Einstieg.

Ordnergenerator-Quellen: [Verknüpfte Modulknöpfe](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:115997), [Ziel des Dokumente-Links](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:116960).

Quellen: [Schnellaktionsdialoge](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:112557), [Weiterleitungen](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:114295), [Fallbeginn/Fallabschluss](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:113165), [Finanz-Unteransichten](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:52419).

## Gemeinsame und eingebettete mobile Bausteine

| Baustein | Vorhandene Ausprägung |
| --- | --- |
| Untere Hauptnavigation | Favoriten, Mehr, dynamische Größe/Zahl der Schaltflächen und modulabhängiges Ein-/Ausblenden beim Scrollen |
| Mehr-Menü | Blatt mit Schnellbereichen und „Menü anpassen“ |
| Navigationseditor | Favoriten bis acht, Live-Vorschau, Pointer-Drag, Reihenfolgepfeile, Speichern/Abbrechen |
| Benutzermenü | Aktueller Fall, Theme-Wechsel sofern verfügbar, Abmelden |
| Fallauswahl | Start und Fachmodule; Einzelfall und fallübergreifende Ansichten |
| Allgemeine Upload-Auswahl | Kamera, Galerie, Mikrofon, Dateien und interner Explorer; Explorer benötigt einen aktiven Serverfall |
| Interner Dateiauswahldialog | Ordner, Dateien, Pfad, Zurück und Übernahme als Anlage |
| Audioaufnahme | Aufnahmestatus, Laufzeit, Beenden und Ressourcenfreigabe; abhängig von Browser-/Mikrofonunterstützung |
| Tabellen als Karten | Spaltenüberschriften werden Feldbeschriftungen; Kalender-/Matrixraster sind ausgenommen |
| Formular- und Aktionslayout | Raster werden einspaltig; Aktionsleisten umbrechen; modulspezifische Ergänzungen |
| Allgemeines Modulfenster | Mobile Höhe, übergeordneter Scroller, Erkennung über `data-mobile-view-profile` |
| Fokussierter neuer Datensatz | Handkasse, Lebensunterhalt, Schulden, Genehmigungen; andere Zeilen ausgeblendet, „Fertig“ führt zurück |
| Eigene Eingabemasken | Zusätzliche Zustandsklassen/Regeln für Kalender, Aufgaben, Fristen, Finanzen, Rechnungen, Fahrten und Wohnen |
| Kontaktdaten/soziales Netzwerk | Mobile Editoren und Ziel-Fall-Auswahl |
| Datei-/Medienlesen und Ausgabe | PDF-/Datei-Leseansicht, Bild-/Medienanzeige, Anlagendownloads und Exportdialoge |
| Interner Benutzerchat | Schwebender Chatknopf, ungelesene Nachrichten/Status; Vollbild mit Unterhaltungsliste oder einzelner Unterhaltung und Zurück |
| Theme und Rückmeldungen | Hell-/Dunkel-Regeln, Toasts oberhalb der Navigation, Safe-Area-Abstände sowie Fokus-/Scrollbehandlung |

Der **interne Benutzerchat** ist der zusätzliche schwebende Chat aus den Screenshots und getrennt vom **KI-Fallchat** der Hauptnavigation. Er ist kein 33. Registry-Eintrag, gehört aber zum mobilen Funktionsbestand. Während seiner Vollansicht wird die Hauptnavigation ausgeblendet; dasselbe gilt für die eigenständige Vollansicht „Fähigkeiten & Alltag“.

Quellen: [Gemeinsame Adaption](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:129582), [Upload-Auswahl](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:129798), [Zustandsbereinigung](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:129658), [Interner Chat mobil](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128521).

## Abgrenzung des mobilen Angebots

- **Online-Formulare:** technisch registriert, aber ausdrücklich aus Favoriten, Mehr-Menü und Anpassungsdialog entfernt. Responsive CSS alleine bedeutet keine Freischaltung.
- **Allgemeine Einstellungen:** kein eigener Mobil-Eintrag; bestimmte Einstellungs-Schaltflächen zusätzlich per CSS verborgen. Das mobile Benutzermenü enthält Darstellung und Abmelden.
- **Separates Desktop-Dashboard, umfassende Fallverwaltung, Sicherung/Wiederherstellung, Administration, Controlling, Datenschutzverwaltung, Außendienstverwaltung und Formular-/Vorlagenverwaltung:** keine eigenen Einträge in dieser Mobil-Registry.
- **Berichte, Rechnungslegung, Ordnergenerator, Fallbeginn und Fallabschluss:** fehlen als Hauptbereiche, haben aber die oben belegten indirekten Zugänge. Sie dürfen nicht pauschal als mobil gesperrt bezeichnet werden.

Diese Abgrenzung beschreibt das offizielle Navigationsangebot, keine umfassende Sperre sämtlicher indirekter Öffner oder generischer Dialoge. Quellen: [ausgeblendete Aktion](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:128819), [Einstellungs-CSS](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html:120527).

## Folgerung für die spätere Überarbeitung

Die Dokumentation liefert das Muster **Liste → Lesen → Bearbeiten**, ergänzt um Filterblatt, sichtbaren Fallkontext und getrennte Inhalts-/Aktionsbereiche. Es ist noch eine modulspezifische Implementierung, kein appweit verwendetes Komponentenpaket.

Die **22 Module im gemeinsamen Profil** sind die größte zusammenhängende Gruppe für eine Übertragung. Die sechs eigenen Layouts, Fähigkeiten & Alltag, interner Chat, Schnellaktionen und indirekte Fachmasken müssen gesondert berücksichtigt werden. Einige erfüllen bereits Teile des neuen Musters; „mobil vorhanden“ und „nach dem neuen Bedienkonzept gebaut“ sind unterschiedliche Merkmale.

## Verifikation

Ausgeführt:

```sh
node --test server/tests/html-mobile-*.test.cjs server/tests/falldokumentation-excel-vorschau.test.cjs server/tests/html-doku-report-targets.test.cjs server/tests/html-documented-personal-contact-prefill.test.cjs
```

**70 Prüfungen erfolgreich, 0 fehlgeschlagen.** Die Auswahl umfasst Quelltext-/Verdrahtungsprüfungen und ausgeführte isolierte JavaScript-Funktionen. Es war kein vollständiger Sicht-/Touchtest aller Module auf iOS und Android. Das [Prüfprotokoll](/Users/zepp/Documents/Codex/2026-07-05/hallo-anbei-erh-ltst-du-die/docs/analysen/mobile-pruefprotokoll-v0.7.7.txt) ist beigefügt.
