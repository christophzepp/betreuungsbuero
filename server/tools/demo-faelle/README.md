# Fünf Demonstrationsfälle

Vollständig ausgefüllte, **frei erfundene** Betreuungsfälle zum Testen der Software und für
Vorführungen. Alle Namen, Anschriften, Aktenzeichen, Bankverbindungen, Diagnosen und Befunde
sind fiktiv; Institutionen sind teils reale Namen mit erfundenen Aktenzeichen.

## Einspielen und Entfernen

```bash
node server/tools/demo-faelle/seed.js
```

```bash
node server/tools/demo-faelle/seed.js --entfernen
```

Der Server muss dafür **nicht** laufen. Die fünf Fall-IDs sind fest verdrahtet (`DEMO_IDS` in
`seed.js`); ein zweiter Lauf überschreibt deshalb die vorhandenen Demo-Fälle, statt Dubletten zu
erzeugen. Bestandsfälle bleiben unberührt. `--entfernen` löscht ausschließlich diese fünf Fälle
samt Falldokumentation, Kontakten, Berichten, Terminen, Aufgaben, Übersichtszeilen, Fahrten und
Ausgangsrechnungen.

## Die fünf Fälle

| Fall | Profil | Schwerpunkt für die Vorführung |
|---|---|---|
| **Auerbach, Margarete** (*1941, Az. 7 XVII 214/19, seit 2019) | Demenz, Pflegegrad 4, stationär, vermögend | Wohnungsverkauf mit gerichtlicher Genehmigung, Rechnungslegung, Patientenverfügung, sieben Jahre Falldokumentation |
| **Kilic, Emre** (*1993, Az. 4 XVII 88/22, seit 2022) | Paranoide Schizophrenie, eigene Wohnung, Bürgergeld | Schuldenregulierung, Unterbringung 2023, Betreutes Wohnen, Einwilligungsvorbehalt auf dem Prüfstand |
| **Rothenberg, Dieter** (*1968, Az. 12 XVII 305/21, seit 2021) | Korsakow-Syndrom, besondere Wohnform, EM-Rente | Verbraucherinsolvenz mit Schlusstermin, Wohnungsauflösung, Konfabulation als Dokumentationsthema |
| **Nowak, Halina** (*1957, Az. 2 XVII 431/23, seit 2023) | Multiple Sklerose, Pflegegrad 3, eigene barrierefreie Wohnung | Voll entscheidungsfähige Betreute, Erbfall mit Grundstück, Wohnraumanpassung, Widerspruchsverfahren |
| **Weidmann, Jonas** (*2005, Az. 9 XVII 62/23, seit Volljährigkeit) | Autismus, WfbM, Außenwohngruppe | Unterstützte Kommunikation, Budget für Arbeit, Wille der betreuten Person gegen Elternwunsch |

## Export- und Versandhistorie, Archiv, Dokumente

Zu jedem Fall gehören **sieben Ausgänge** und **drei Archivstände**. Für jeden Ausgang erzeugt
der Seeder eine echte PDF-Datei (Briefkopf des Büros, Anschriftenfeld, Betreff, Fließtext,
Unterschrift) und legt sie im Dokumentenspeicher ab – Berichte, Rechnungslegung und Vergütung
unter Register 10 im passenden Berichtszeitraum, alles Übrige unter `11 - Betreuungsführung /
Dokumentenausgang / <Jahr> / <Monat>`. Der Historieneintrag trägt denselben Beleg wie ein echter
Export (`exportRef` mit Datei-Kennung, SHA-256, Größe, Seitenzahl und Ordnerpfad), sodass die
Prüfung „Im Dokumentenspeicher: unverändert" anschlägt und die Datei aus der Historie heraus
geöffnet werden kann. Versendete und gedruckte Ausgänge erzeugen zusätzlich eine Zeile im
Betreuungsverlauf (`history` mit `sourceExportId`), genau wie `phase4SyncCaseHistory` es tut.

Die Ausgänge decken bewusst alle Zustände und Wege ab: versendet per Post, Mail, Fax und eBO,
gedruckt sowie vorbereitet und nur erstellt (Entwürfe, die noch nicht heraus sind). Die
Archivstände sind Vorberichte mit eigenem Inhalt – der Jahresbericht des Vorjahres unterscheidet
sich vom laufenden, damit sich die Übernahme aus dem Vorbericht vorführen lässt.

### Fähigkeiten & Alltag

Jeder Fall bringt ein vollständiges Fähigkeitsprofil mit: alle **neun Lebensbereiche** (Kommunikation,
Orientierung, Mobilität, Gesundheit und Selbstversorgung, Wohnen und Haushaltsführung, Alltag und
soziale Teilhabe, Arbeit und Bildung, Behörden und Recht, Finanzen und Vermögen) mit Ressourcen,
Einschränkungen, Quelle, Stand und Wiedervorlage, dazu die **Gestaltung der Alltagssituation** mit
allen sieben Teilfeldern und die **Wunschäußerung** mit Status, Begründung, erforderlicher
Unterstützung und Kommunikationswegen. Einzelne Bereiche sind bewusst mit fälliger Wiedervorlage,
ohne Berichtsfreigabe oder mit verknüpften Bedarfen aus „Bedarfe & Wille" ausgestattet, damit sich
die Kennzahlen, Filter und Brücken des Menüs vorführen lassen. Der Datenblock liegt am Ende jedes
Fallmoduls (`module.exports.faehigkeiten`) und wird vom Seeder nach
`goalDecisionPlanning.functionalProfile` geschrieben.

## Was gefüllt ist

Je Fall: Stammdaten (Person, Betreuungsverfahren mit Aufgabenkreisen, Gesundheit, Leistungen,
Identifikationsnummern, Versicherungen, Bankverbindungen, Vorsorge, Soziales Netzwerk,
Verfügungsbudget), Gesundheitsübersicht (mehrere Diagnosen, Medikamente, Ärzte, Notfallkontakte,
Arzttermine, Krankenhausaufenthalte, Eingriffe), Wohnen mit Verlaufseinträgen, Vermögensaufstellung
(Anfang/Ende, Schulden), Lebensunterhalt, Schuldenregulierung mit Ratenplänen, Handkasse über
mehrere Monate, Genehmigungen, Fristen (mit verknüpftem Kalender- und Aufgabeneintrag),
Bedarfe & Wille, Rechnungslegung, Adressbuch über alle sieben Kategorien, Falldokumentation über
mehrere Jahre, Kalendertermine, Aufgaben, Kontaktmonitor-Profil, Betreuungsübersicht,
Fahrtkostennachweis, Ausgangsrechnungen, vorbefüllte Formulare/Berichte, Export- und
Versandhistorie mit abgelegten PDF-Dateien, Fallakten-Archiv, Betreuungsverlauf und das
Fähigkeitsprofil (siehe oben).

## Aufbau

- `lib.js` – Bausteine (Datumsformate, Tupel-Expansion, Schuldenspiegel in die Vermögensaufstellung, Vorsorgekatalog, Ausgangs- und Archivgerüst, Fähigkeitsprofil)
- `dokumente.js` – PDF-Erzeugung (Anschreiben und Bericht) mit `@cantoo/pdf-lib`
- `fall-1-auerbach.js` … `fall-5-weidmann.js` – je ein Fall als reines Datenmodul
- `seed.js` – schreibt in die Datenbank und legt die Aktenordner (Register 00–12) an

Die Feld- und Wertelisten folgen den Vorgaben der App (`SCHEMAS`, `SUGGESTION_DEFAULTS_V1`,
`ADDRESSBOOK_CATEGORIES`, `PROVISION_TYPES_V156`). Werden dort Felder umbenannt, sind die
Datenmodule entsprechend nachzuziehen.
