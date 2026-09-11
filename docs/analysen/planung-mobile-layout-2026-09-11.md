# Mobilkorrekturen für Aufgaben, Fristen und Wiedervorlagen

Ausgangspunkt: Beta-Stand `cb31027`, Nutzerhinweise vom 11. September 2026.

## Korrekturen

- Die allgemeine Mobilanpassung fügte den eigenen Aktionsleisten dieser drei Arbeitsbereiche eine zusätzliche Streckregel hinzu. Dadurch wurde „Neue Aufgabe“ mitten im Wort umgebrochen. Die Arbeitsbereiche behalten jetzt ihre eigenen responsiven Anordnungen. Auch auf kleinen Geräten bleibt die vollständige Beschriftung sichtbar; die Werkzeugaktion hat eine ausdrückliche zugängliche Beschriftung.
- Das Schließen-X der Fristen steht am rechten Rand. Auf schmalen Telefonen steht die Dokumentenerkennung in einer eigenen Zeile unter „Neue Frist“ und Schließen.
- Bei Wiedervorlagen wird die linke Filterleiste bis 880 Pixel Arbeitsbereichsbreite ausgeblendet. Die Liste nutzt die volle Breite; sämtliche Filter bleiben über die Filter-Schaltfläche erreichbar.
- Kopfzeile, Statusauswahl, Sortierung und Aktualisieren sind für schmale Fenster angeordnet. Aktualisieren und Sortierung haben die gleiche Höhe. Eintragszeilen wurden kompakter, ohne Inhalte zu entfernen.
- Der Dunkelmodus färbt das Suchfeld nicht mehr als zweite Fläche innerhalb der Suchleiste. Auswahlfelder mit eigenem SVG-Pfeil erhalten keinen zusätzlichen Pfeil aus der allgemeinen Mobilregel.

## Verifikation

- Die Fehler wurden mit aktivierter iPhone-Oberfläche in WebKit reproduziert. Ein schmales Desktopfenster allein aktiviert diese allgemeinen Mobilregeln nicht; der neue Prüfstand berücksichtigt daher ausdrücklich den User-Agent.
- Neuer Browserprüfstand: `server/scripts/qa-planning-mobile-layout.cjs`, aufrufbar mit `PLANNING_MOBILE_LAYOUT_AUDIT=1` über `qa-followup-workspace.cjs`.
- Je 121 Prüfungen erfolgreich mit iPhone-Oberfläche in WebKit und Chromium sowie mit Desktop-Oberfläche in WebKit: 320, 390, 574, 768, 1024 und 1440 Pixel, jeweils hell und dunkel.
- Geprüft wurden vollständige Beschriftungen, rechter Schließen-Button, horizontale Überläufe, erreichbare Status-/Sortierfunktionen, Filter anwenden, Wiedervorlage öffnen/anlegen/schließen und Laufzeitfehler. Mobil- und Desktopbilder wurden zusätzlich visuell kontrolliert.
- 26 gezielte automatisierte Tests für Wiedervorlagen, Fristen und das Smartphone-Layout bestanden.
- Die Anwendungsänderungen beschränken sich auf die drei Stilblöcke, die zugängliche Werkzeugbeschriftung und die Ausnahme in der allgemeinen Aktionsleisten-Anpassung. Alle übrigen Anwendungsbytes wurden mit dem Ausgangsstand verglichen.

Die Prüfung verwendet ausschließlich fiktive Daten und abgefangene Netzaufrufe.
