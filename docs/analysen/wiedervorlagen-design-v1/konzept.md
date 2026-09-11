# Wiedervorlagen – Menüentwurf

Stand: 11. September 2026. Das neue Menü ist ein interaktiver Entwurf mit Beispieldaten, noch kein Bestandteil der produktiven Anwendung.

## Begriffsklärung im bestehenden Fristen-Menü

Die Vorlaufangabe heißt jetzt **Erinnerung vor Fristablauf**. Angepasst wurden Fristenformulare und Detailhinweise, der Schnelleinstieg in der Fallübersicht, das Fristenformular aus E-Mail, erzeugte Aufgabentitel/-beschreibungen sowie textbasierte Exportüberschriften. Der Kalender übernimmt den neuen Titel ohne zusätzliches „Wiedervorlage: “.

Der Erinnerungsvorlauf und das eigentliche Fristdatum bleiben unverändert. Bestehende Daten und die technische Zuordnung der verknüpften Aufgaben werden nicht migriert. Bereits gespeicherte Titel werden nicht pauschal umgeschrieben; die neue Bezeichnung wird beim Anlegen bzw. erneuten Abgleich erzeugt. Die vorgefertigte eingebettete Excel-Vorlage und ihre gespeicherten Überschriften werden mit dieser Änderung nicht neu erzeugt.

## Vorgeschlagenes neues Menü

- Eine Übersicht über echte Wiedervorlagen aus Datei-Explorer, Posteingang, E-Mail, Fallübersicht, Wünsche/Ziele und Fallbeginn.
- Ein Original kann über mehrere Herkunftsorte erreichbar sein. Dieselbe Wiedervorlage wird in der Gesamtübersicht genau einmal angezeigt.
- Suche nach Titel, Original, Notiz und Fall; Filter für Fall, Zeitraum, Herkunft und Priorität; Status Offen/Erledigt/Alle; Sortierung nach Datum oder Titel.
- Datumsgruppen: überfällig, heute, nächste sieben Tage, später, erledigt. Zeitraumfilter für sieben bzw. 30 Tage schließen überfällige Einträge ein.
- Details zeigen Datum, Priorität, Fall, Herkunft, Original und Notiz. Das Original lässt sich im Entwurf als Beispielvorschau öffnen.
- Anlegen erfordert ein bestehendes Original, Titel und Datum. E-Mail-Wiedervorlagen besitzen zusätzlich eine Uhrzeit. Eine bereits vorhandene offene Wiedervorlage kann direkt geöffnet werden.
- Bearbeiten, Verschieben mit frei wählbarem Datum oder +1/+7/+14 Tagen, Erledigen/Wiederöffnen und Löschen mit Bestätigung. Änderungen lassen sich rückgängig machen; ungespeicherte Angaben werden vor dem Verlassen geschützt.
- E-Mail-Wiedervorlagen bleiben als Zurückstellen bis zur Rückkehr in den Posteingang erkennbar. „Jetzt zurückholen“ beendet das Zurückstellen.
- Löschen betrifft die Wiedervorlage. Das verknüpfte Original bleibt bestehen.
- Auf breiten Flächen können Details neben der Liste erscheinen, auf schmalen Flächen erhalten sie die ganze Breite. Mobile Filter öffnen eine eigene Ansicht.
- Entwurfsvarianten: angenehme/kompakte Listendichte, Details daneben/eigene Ansicht, mobile Vorschau sowie hell/dunkel.

Erinnerungen vor Fristablauf gehören fachlich zur Frist und sind im Entwurf nicht als echte Wiedervorlagen enthalten. Bei einer späteren Umsetzung muss insbesondere die bestehende technische Kennzeichnung solcher Fristerinnerungs-Aufgaben berücksichtigt werden. Die Entwurfsdaten ersetzen keine Bestandsaufnahme der Berechtigungen und Datenquellen für die spätere Implementierung.

## Prüfungen

- Entwurf: jeweils 60 erfolgreiche Bedien- und Layoutprüfungen in Chromium und WebKit; 320 bis 1024 Pixel Inhaltsbreite, Desktop und Mobil, hell und dunkel.
- Sichtprüfung: Suche, Liste, Details und Formular. Zu flache native Safari-Auswahlfelder korrigiert; Detailaktionen gleichmäßig angeordnet.
- Fristen: vorhandene Browserprüfung in WebKit erfolgreich, einschließlich Speichern, Abgleichen, Wiederholungen, Fehlerbehandlung und mobilen Ansichten.
- 12 erfolgreiche automatisierte Prüfungen: Fristenfunktionen, Kalenderübernahme der umbenannten Erinnerung sowie Skriptbestand und Syntax.

Keine Veröffentlichung und kein Push durchgeführt.

## GUI-Korrektur des Entwurfs

„dd“ wurde vom Nutzer als „Darstellungsfehler“ klargestellt. Die Korrektur betrifft den Entwurf.

- Automatisches Erscheinungsbild erbt jetzt tatsächlich den App-Modus. Vorher konnte eine dunkel eingestellte App einen hellen Entwurf anzeigen, wenn die Betriebssystem-Voreinstellung hell war.
- Nebenbeschriftungen sind in beiden Modi kontrastreicher.
- Mobile Kopfzeile verwendet den kompakten Button „Neu“ mit vollständiger zugänglicher Beschriftung. Auch der mobile Filterbutton hat eine zugängliche Beschriftung.
- Statusauswahl, Filterchips, Sortierung und Listeneinträge erhalten ausreichend große mobile Trefferflächen. Die Sortierung zeigt wieder einen Auswahlpfeil.
- Lange Titel werden im Formular umbrochen; das Titelfeld wächst mit dem Inhalt.
- Die Rückfrage zu ungespeicherten Änderungen steht vor den Eingabefeldern und erhält den Tastaturfokus.
- Tastaturfokus bleibt beim Statuswechsel, Filtern und Sortieren erhalten.
- Doppelte „Heute“-Kennzeichnungen und nach dem Schließen veraltete Auswahlmarkierungen sind entfernt.

Die bestehenden 60 Bedien-/Layoutprüfungen je Browser wurden erneut bestanden. Ergänzend bestanden jeweils 16 gezielte GUI-Prüfungen in Chromium und WebKit zu App-Themenwechsel, Touchflächen, Tastaturbedienung, Titelumbruch und Rückfragen. Bei der Sichtprüfung wurde außerdem der Original-Öffnen-Button unter der Herkunftsbeschreibung ausgerichtet.
