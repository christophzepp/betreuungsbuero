# Wiedervorlagen: Umsetzung und Prüfung

Stand: 11. September 2026.

Der freigegebene Entwurf ist als `followup-workspace-v1` in der ausgelieferten Anwendung umgesetzt. Bestehende Aufgabeneinträge bleiben die gemeinsame Datenquelle. Dokumente werden weiterhin über die vorhandenen Speicherroutinen synchronisiert. Die bisherigen Aufrufstellen der Fallübersicht und die mobile Navigation öffnen die neue Übersicht.

| Bereich | Umsetzung |
| --- | --- |
| Linke Menüleiste | Direkt nach Fristen; Aufklappen mit fälligen Einträgen, Zähler, Öffnen und Neuanlage; zugängliche Beschriftungen und Tooltip |
| Übersicht | Suche, Fall, Zeitraum, Herkunft, Priorität; Offen/Erledigt/Alle; Datum-/Titelsortierung und Fälligkeitsgruppen |
| Quellen | Datei-Explorer einschließlich Bürodokumenten, Posteingang, E-Mail, Fallübersicht, Wünsche/Ziele und Fallbeginn; kanonische Einträge werden nicht zusätzlich kopiert |
| Fristerinnerungen | Über Herkunft und vorhandene Frist-Verknüpfungen ausgeschlossen; bleiben bei den Fristen |
| Original | Tatsächliches Dokument oder vorhandener Vorgang wird geöffnet; fehlende Originale erhalten einen Hinweis |
| Erstellen/Bearbeiten | Bestehendes Original, Titel, Datum, Priorität und Notiz; Dublettenprüfung; bestehende Fall-/Quellverknüpfung erhalten |
| Verschieben | Frei wählbares Datum und +1/+7/+14 Tage; überfällige Einträge ab heute |
| Status und Serien | Erledigen/Wiederöffnen; wiederkehrende Einträge erhalten die nächste Fälligkeit |
| Weitere Funktionen | Serie, Anlagen und weitere Aufgabenoptionen über den vorhandenen vollständigen Editor erreichbar |
| E-Mail | Liste tatsächlicher Zurückstellungen, Datum/Uhrzeit ändern, Original öffnen, neue Zurückstellung und echte Rückholung in den Posteingang |
| Schutz vor Verlust | Schreibfehler erhalten Eingaben; lokale Speicherfehler werden gemeldet; Konfliktprüfung vor Änderungen; Schutz ungespeicherter Formulare |
| Rückgängig | Speichern, Datums- und Statusänderungen regulärer Wiedervorlagen; kein Überschreiben zwischenzeitlicher Änderungen |
| Gestaltung | Farben, Icons, Aufbau und Detail-/Formularansichten aus dem korrigierten Mockup; eigenständig scrollende Bereiche, angepasste mobile Kopfzeile, Hell/Dunkel |

E-Mail-Zurückstellungen folgen dem vorhandenen Postfachmodell: Nach der Rückkehr in den Posteingang entfällt der aktive Zurückstellungsdatensatz. Betreff und Inhalt bleiben im Original; der Editor verändert Datum und Uhrzeit. Rückholung und endgültiges Löschen werden nicht als lokal rückgängig machbare Vorgänge angeboten. Reguläre erledigte Wiedervorlagen bleiben unter „Erledigt“ erhalten. Beim Löschen bleibt das Original bestehen.

## Behobene Fehler

- Mobile Menüschaltfläche überdeckte die Überschrift; im geöffneten Wiedervorlagenfenster ausgeblendet.
- Mobile Modulzuordnung war zunächst doppelt; Wiedervorlagen besitzen eine eigene eindeutige Wurzel.
- Alte Erfolgsmeldungen beanspruchten Platz in neu geöffneten Formularen; beim Ansichtswechsel entfernt.
- Auf kleinen Flächen bleiben Details und Formulare im sichtbaren Fenster scrollbar. Titelfelder wachsen mit langen Inhalten.
- Fehler und Ladehinweise erhalten eine passende Darstellung statt einer Erfolgsmeldung.
- Datumslose Altbestände bleiben sichtbar und werden nicht als überfällig gewertet.
- Fehlgeschlagene E-Mail-Rückholungen verlieren ihre Wiedervorlage nicht mehr nach mehreren Versuchen; automatische und manuelle Rückholung können dieselbe Nachricht nicht gleichzeitig verschieben.
- Gleichzeitige Neuanlagen derselben E-Mail werden abgefangen.
- Der Fallbezug zurückgestellter E-Mails wird anhand der stabilen Message-ID erhalten; Fallrechte werden dabei berücksichtigt.
- Lokales Anlegen und Löschen melden Speicherfehler verlässlich.
- Quellen aus Wünsche/Ziele und eindeutig zuordenbare alte Fallbezeichnungen bleiben erreichbar; explizite Fallkennungen haben Vorrang.

## Validierung

- Gesamtsuite: **1.393 bestanden, 0 fehlgeschlagen**.
- Browser: **40 Prüfungen in Chromium und 40 in WebKit** mit synthetischen Daten und abgefangenen Serveranfragen.
- Breiten: 320, 390, 768 und 1440 Pixel; helle und dunkle Listen, Filter, Details und Formulare.
- Zusätzlich **12 gezielte ausgeführte Prüfungen** zu Quellenzuordnung, Datumsprüfung, Konflikten, lokalen Speicherfehlern, E-Mail-Zugriffsschutz, Wiederholungsversuchen und konkurrierender Rückholung.
- Sichtprüfung anhand der beigefügten Bildschirmbilder; produktive Daten wurden bei den Prüfungen nicht verändert.

Kein Push. Änderungen verbleiben im Arbeitsstand; Main wurde nicht verändert.
