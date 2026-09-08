# Visueller Abgleich der 32 mobilen Menüs

Stand: 8. September 2026. Alle 32 freigeschalteten Hauptmenüs wurden mit den freigegebenen Mockups verglichen. Gefundene Layout- und Bedienfehler sind im lokalen App-HTML korrigiert. Die [Vergleichsgalerie](mobile-sichtabgleich-v1/index.html) zeigt je Menü Mockup, bisherigen Bau und korrigierte Ansicht sowie verfügbare Detail-, Formular- und Filteraufnahmen.

Als Referenz dienen `mobile-menues-neuer-stil.html`, die vier ursprünglichen Dokumentationsaufnahmen und das später freigegebene Konzept `fester-chat-zugang.html`. Deshalb zeigt die korrigierte untere Navigation „Chats“, während die älteren Modulmockups noch „KI-Chat“ enthalten.

Der Vergleich betrifft die aktuelle lokale Umsetzung auf Grundlage der ursprünglichen Inventarisierung von stable v0.7.7 (`9b28c434343743b116da66f37cb88d0b7cbc2019`). Der zu Beginn dieser Prüfung vorhandene Arbeitsstand wurde als unveränderliche Vergleichsbasis gesichert. Bereits vorhandene lokale Änderungen wurden weiterverwendet.

## Korrigierte Abweichungen

- **Gemeinsame Gestaltung:** dunkelblaue Kopfzeilen, klare Titelhierarchie, zusammenhängende Bereichsreiter, flache Listen und besser getrennte Metadaten. Personenlisten erhalten Initialen; native Datei- und Historieneinträge erkennbare Symbole und Detailpfeile.
- **Filterblätter:** einheitlicher Filterkopf, Zurücksetzen oben, feste Anwenden-Aktion unten. Auswahlfelder sind mindestens 46 Pixel hoch und verwenden 16-Pixel-Schrift. Insbesondere Adressbuch, Finanzen und Fahrtkosten hatten zuvor zu schmale oder zu kleine Bedienelemente.
- **Details und Formulare:** besser getrennte Bezeichnungen und Werte, mehr Platz für längere Notizen, deutlichere Beträge und Titel sowie ruhige, fest erreichbare Detailaktionen. Leere Angabenblöcke und doppelte Archivwerkzeugleisten entfallen. Textfelder übernehmen die normale App-Schrift.
- **Neue Einträge:** Listen mit genau einer Plus-Aktion erhalten den runden Erfassungsbutton nach dem Mockup. Die Speichern-/Abbrechen-Leiste bleibt in Formularen fest erreichbar. Schnellnotizen verwenden den gesamten mobilen Arbeitsbereich.
- **KI-Fallchat:** doppelte Kopfzeile entfernt, mobile Titel gekürzt, Eingabe verbreitert und Werkzeuge in eine eigene Zeile gesetzt. Die Gesprächsauswahl nutzt eine vollständige mobile Liste und schließt nach Auswahl eines Gesprächs. Anlagen, Spracheingabe, Einstellungen und weitere Chatwerkzeuge bleiben angebunden.
- **Start, Stammdaten und Benutzer:** einheitlicher Startkopf, erkennbarer aktueller Fall und Profilbereich. Das Benutzermenü bietet echte Fallauswahl, vorhandene Darstellungseinstellungen, Favoritenbearbeitung und Abmelden.
- **Fachliche Bereichsreiter:** direkte Zugänge zu den tatsächlich vorhandenen Filtern bzw. Bereichen in Gesundheit, Wohnen, Fähigkeiten, Planung, Genehmigungen, Kontaktmonitor, Betreuungsübersicht, Posteingang und Qualifikationen. Die Fallübersicht führt direkt zu Verlauf, Wiedervorlagen und allen Schnellaktionen.
- **Kalender:** Datum und Heute-Navigation passen gemeinsam in eine kompakte Zeile.
- **Ausgangsrechnungen:** zusätzlich einen Funktionsfehler behoben: Wiederkehrende Layoutsignale konnten den Wechsel eines offenen Formulars von Mobil auf Desktop unbegrenzt verzögern. Die Verarbeitung läuft nun trotz weiterer Signale; ein Browser-Regressionsfall sichert den Wechsel und den Erhalt des Entwurfs ab.

## Abdeckung aller 32 Menüs

„Zusatzaufnahmen“ benennt die zugeordneten tatsächlichen Arbeitsabläufe in der Galerie. Fehlende Szenen bedeuten, dass keine gleichartige Vergleichsaufnahme zugeordnet ist; das Mockup enthält teilweise nur beispielhafte Ansichten. Alle vier Referenzbilder jedes Menüs bleiben in der Galerie verfügbar.

| Nr. | Menü | Schwerpunkt des Abgleichs | Zusatzaufnahmen |
|---:|---|---|---|
| 1 | Start | Kopf, Fallumfang, Kennzahlen und Schnellaktionen | — |
| 2 | KI-Fallchat | Gesprächsliste, Kopf, Eingabe und Werkzeuge | Details |
| 3 | Stammdaten | Identitätskopf, Bereiche und tatsächliche Eingabefelder | Details/Bearbeitung |
| 4 | Fallübersicht | Verlauf, Wiedervorlagen, Schnellaktionen, Vollansicht der Schnellnotiz | Formular, Filter |
| 5 | Falldokumentation | Referenzstil, Kalender, Filterblatt und Erfassung | Formular, Filter |
| 6 | Kalender | Tagansicht, kompakte Datumsnavigation, Terminabläufe | Formular, Filter, Details |
| 7 | Aufgaben | Liste, fachliche Filter, Details, Eingabe und Status | Formular, Filter, Details |
| 8 | Fristen | Liste, Filter, Fristdetails und Fachformular | Formular, Filter, Details |
| 9 | Wiedervorlagen | Liste, Termin- und Statusangaben, feste Aktionen | Formular, Details |
| 10 | Adressbuch | Listen- und Auswahlfunktionen, volle Filterbreite | Formular, Filter, Details |
| 11 | E-Mail | Nachrichtenliste, Ordner, Nachricht und Verfassen | Formular, Filter, Details |
| 12 | Datei-Explorer | Dateiliste, Details, Upload und Filter | Formular, Filter, Details |
| 13 | Archivierte Formulare | Lesedetail, eigene Bearbeitung, keine doppelte Werkzeugleiste | Formular, Filter, Details |
| 14 | Export- und Versandhistorie | Detailkopf, Versanddaten, Filter und Eintragsaktionen | Filter, Details |
| 15 | Banking | Umsätze, Kontoauswahl, Überweisung und Detailaktionen | Formular, Filter, Details |
| 16 | Handkasse | Buchungen, Bestand, Belege und Eingabe | Formular, Filter, Details |
| 17 | Vermögensaufstellung | Bestände, Summen, Positionen und Fachfelder | Formular, Filter, Details |
| 18 | Lebensunterhalt | Einnahmen, Zeiträume, Beträge und Zuordnungen | Formular, Filter, Details |
| 19 | Schuldenregulierung | Forderungen, Gläubiger, Zahlungen und Aktionen | Formular, Filter, Details |
| 20 | Gesundheit | Direkte Bereiche, sieben Fachmasken, Verfügungen | Formular, Filter, Details |
| 21 | Wohnen | Verlauf, Adressen und Wohnkosten | Formular/Adressbereich, Filter |
| 22 | Fähigkeiten & Alltag | Elf echte Bereiche, Erfassungsstand und Fachformulare | Formular, Filter, Details |
| 23 | Wünsche und Bedarfe | Alle sechs Eintragsarten und ihre Fachformulare | Formular, Filter, Details |
| 24 | Genehmigungen | Laufende/abgeschlossene Vorgänge, Details und Eingabe | Formular, Filter, Details |
| 25 | Kontaktmonitor | Personenlisten, Kontaktfälligkeit und Erfassung | Formular, Filter, Details |
| 26 | Betreuungsübersicht | Aktuelle/archivierte Fälle und Personenangaben | Filter, Details |
| 27 | Posteingang | Bearbeitungsstände, Details, Vorschläge und Aktionen | Filter, Details |
| 28 | Finanzen | Laufende Posten, größere Filterfelder und Fachformular | Formular, Filter, Details |
| 29 | Ausgangsrechnungen | Beträge, Status, Formular und Wechsel auf Desktop | Formular, Filter, Details |
| 30 | Fahrtkosten | Fahrten, Nachweise, Fahrzeuge und Filterfelder | Formular, Filter, Details |
| 31 | Qualifikationsmanager | Personen, vorhandene Nachweise und Bearbeitung | Formular, Filter, Details |
| 32 | Benutzermenü | Profil, Fallauswahl, Darstellung, Favoriten und Abmelden | — |

Zusätzlich wurden Rechnungslegung, Büroarchiv und Büroversand sowie der gemeinsame Chats-Zugang in den zugehörigen Browserpaketen geprüft. Rechnungslegung ist über die bestehenden fachlichen Zugänge erreichbar und kein zusätzliches Element der ursprünglichen Liste mit 32 Hauptmenüs.

## Bewusst erhaltene Unterschiede zum Entwurf

Die Mockups sind Gestaltungsreferenzen mit vereinfachten Beispieldaten. Die Umsetzung behält reale Funktionen und Datenbedeutungen:

- Aufgaben verwenden gemäß Nutzerentscheidung die vorhandenen Fall- und Listenzuordnungen. Es wurde keine zusätzliche Mitarbeiterzuständigkeit erfunden.
- Die Dokumentation behält ihren Wochenkalender; Start behält die fünf bestehenden Kennzahlen und alle 30 Schnellaktionen.
- Fähigkeiten zeigt alle elf tatsächlichen Bereiche, Planung alle sechs tatsächlichen Eintragsarten. Lange Bereichsreihen bleiben horizontal erreichbar.
- Finanzansichten unterscheiden weiterhin Auswahlwerte, Gesamtwerte und Kontobezug. Die Überweisung bleibt ausdrücklich beschriftet. Die fachlichen Zusatzfelder werden nicht zugunsten kürzerer Mockup-Formulare weggelassen.
- Stammdaten und Posteingang behalten ihre vorhandenen Bearbeitungs- bzw. Speicherabläufe. Das Benutzermenü verwendet die echte zeitgesteuerte Einstellung „Nachts dunkel“.
- Die alten und neuen Aufnahmen können unterschiedliche synthetische Namen, Beträge, Eintragsmengen und Scrollstände zeigen. Archiv und Versandhistorie sind in der Hauptgegenüberstellung als Detailansichten zugeordnet. Die Chat-Hauptgegenüberstellung enthält unterschiedliche Zustände; die Gesprächsaufnahmen stehen zusätzlich unter Details.

Die Oberflächen sind damit an den gemeinsamen Stil angeglichen, ohne Pixelidentität oder identische Beispielinhalte zu behaupten.

## Prüfung und Nachweise

- **204 mobile Codeprüfungen bestanden**, kein Fehler: [Testprotokoll](mobile-sichtabgleich-v1/code-tests.log).
- **17 Browserpakete erfolgreich:** Fundament, Navigation, Aufgaben, erstes Modulpaket, Kalender, E-Mail, Explorer, Banking, Rechnungslegung, Handkasse, Vermögen, Lebensunterhalt, Schulden, Finanzen, Rechnungen, Fahrtkosten und Abschlussmodule. Die Abschlussmodule enthalten 143 Prüfungen ohne Fehler oder JavaScript-Laufzeitfehler.
- **41 ergänzende Prüfungen bestanden:** unter anderem Chat bei 320/390/430 Pixeln, Gesprächsauswahl, Profil und Darstellung, neue Bereichsreiter, Filtergrößen und Schnellnotiz.
- Visuelle Referenz: **128 Mockup-Aufnahmen**, 32 Hauptgegenüberstellungen und 79 zusätzliche Szenenzuordnungen. Die acht Tafeln `nachvergleich-1.png` bis `nachvergleich-8.png` zeigen alle Hauptgegenüberstellungen kompakt.
- Die Browserpakete prüfen unter anderem unterschiedliche Smartphonebreiten, Hell/Dunkel, Navigation beim Scrollen, Tastaturzustand, Entwurfserhalt, Speichern/Abbrechen, fachliche Aktionen und den Rückweg auf Desktop. Fachliche Prüfungen laufen mit abgefangenen APIs und synthetischen Daten.

Die Prüfung verwendet **Chromium mit Smartphone-Emulation**. Ein zusätzlicher Test auf einem physischen iPhone/Safari wurde nicht durchgeführt. Die Ergebnisse belegen die geprüften lokalen Abläufe; sie ersetzen keinen vollständigen Test jeder denkbaren Kombination mit produktiven Konten und Daten.

[Zusammengefasste Prüfergebnisse](mobile-sichtabgleich-v1/pruefergebnisse.json) · [Browserpaket-Ergebnisse](mobile-sichtabgleich-v1/nachher/results.json) · [Ergänzende Prüfungen](mobile-sichtabgleich-v1/nachher/qa-supplemental.json)

## Quellstand und Wiederholung

Geändert wurde `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html` in elf gezielten Skriptblöcken und einem Stilblock. Die 82 eingebetteten typisierten Datenblöcke bleiben bytegleich; die HTML-Datei enthält weiterhin 311 Skriptblöcke. Die 229 ausführbaren JavaScript-Blöcke lassen sich parsen. Keine globale HTML-Neuserialisierung.

Die SHA-256-Werte der vorherigen und korrigierten Datei stehen im [Quellstandnachweis](mobile-sichtabgleich-v1/quellstand.json).

Werkzeuge für eine Wiederholung:

- `server/scripts/qa-mobile-visual.cjs`: Mockup-Aufnahmen (`VISUAL_MODE=mockups`) und ergänzende lokale Prüfungen.
- `server/scripts/qa-mobile-visual-all.cjs`: 16 vorhandene Browserpakete; `qa-mobile-completion.cjs` prüft die Abschlussmodule separat.
- `server/scripts/qa-mobile-visual-gallery.cjs`: baut die lokale Galerie aus den vorhandenen Vergleichsdaten und prüft sämtliche Bildpfade.
- `server/scripts/qa-mobile-invoices.cjs`: enthält den zusätzlichen Regressionstest für den Größenwechsel bei fortlaufenden Layoutsignalen.

Die Änderungen liegen lokal im Arbeitsstand vor.
