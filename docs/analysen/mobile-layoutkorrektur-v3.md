# Mobile Layoutkorrektur vom 08.09.2026

Ausgangspunkt: Nutzeraufnahmen der lokalen Beta in Safari mit iPhone-Kennung. Grundlage ist Commit `0e404cca99d2642409396c241faa3de49c926774`. Veröffentlichungsziel ist der Beta-Zweig `develop` mit dem automatisch gebauten Beta-Image. Ein bereits laufender lokaler Container benötigt anschließend ein Image-Update.

[Visueller Vorher-nachher-Vergleich](mobile-layoutkorrektur-v3/index.html)

## Korrekturen

| Bereich | Ursache und Änderung |
| --- | --- |
| Gemeinsame Arbeitsfläche | Die Navigation reservierte auch unsichtbar 78 px. Jetzt wird ihre tatsächliche Höhe gemessen; beim Ausblenden fällt die Reserve bis auf die Safe Area weg. Mobile Dialoge füllen den verfügbaren Bereich bis zur Navigation beziehungsweise zum Bildschirmrand. |
| Fußleisten | Unter neuen Modulansichten konnte die alte Schließen-Leiste stehen bleiben. Sie wird bei einer mobilen Modulansicht ausgeblendet; deren eigene Aktionen übernehmen den Abschluss. |
| Start | Die Kennzahlen wurden innerhalb eines Flex-Containers auf ihre Inhaltsbreite zusammengeschoben. Das Raster nutzt nun die Kartenbreite, mit mindestens 44 px breiten Plus-Aktionen. |
| Adressbuch | Die allgemeinen Icon-Button-Regeln konnten den Plus-Button oval machen. Breite, Höhe, Boxmodell und Flex-Größe sind nun für alle gemeinsamen Plus-Buttons eindeutig. |
| E-Mail | Alte Regeln verbargen bei geöffnetem KI-Assistenten Nachricht und Anlagen und ließen den Assistenten im neuen Scroller zusammenschrumpfen. Alle drei Bereiche bleiben sichtbar; Verlauf, Schnellaktionen und Eingabe erhalten nutzbare Größen. Leere Mindesthöhe bei Textnachrichten entfällt. Die Sandbox für HTML-E-Mails bleibt unverändert. |
| Datei-Explorer | Fallauswahl erhält die gemeinsame Feldgestaltung. Die drei Ordneraktionen stehen in einem geordneten Raster. Doppelte kleine Auf-/Zuklapp-Links entfallen in diesem Blatt; die Funktionen bleiben über die großen Schaltflächen verfügbar. |
| Kontaktmonitor | Stamminformationen und Kontaktverlauf sind getrennt. Jede Kontaktnotiz steht unter Datum und Kontaktart und nutzt unabhängig von der Textlänge die volle Breite. Die Suche berücksichtigt weiterhin auch die Notizen. |
| Kontaktprofil | Das vorhandene Formular mit allen 25 Eingabeelementen wird in Kopfzeile, Inhaltsscroller und Aktionsleiste eingebettet. Speichern verwendet die ursprüngliche Fachlogik einschließlich Dokumentationsverknüpfung. Abbrechen schützt ungespeicherte Eingaben; Speicherfehler bleiben im Formular sichtbar. |

Die vier Navigationsregeln bleiben bestehen: abwärts ausblenden, aufwärts einblenden, bei Seitenanfang/Ansichtswechsel anzeigen, bei Bildschirmtastatur ausblenden. Die Änderung betrifft zusätzlich die freigegebene Arbeitsfläche.

## Prüfung

- 204 gezielte mobile Codeprüfungen erfolgreich.
- WebKit: 24 Navigationsprüfungen, 53 E-Mail-Prüfungen, 57 Explorer-Prüfungen, 143 weitere Modulprüfungen und 16 Prüfungen der konkret gemeldeten Layouts und Profilaktionen.
- Chromium: dieselben 16 gezielten Layout- und Profilprüfungen erfolgreich.
- 229 ausführbare JavaScript-Blöcke syntaktisch geprüft. Große eingebettete Datenblöcke und das vorhandene NUL-Byte blieben unverändert.
- Vorher- und Nachher-Aufnahmen mit derselben synthetischen Szene: Die vorherige Fassung reproduziert das zu schmale Startraster, den ovalen Plus-Button und die fehlende mobile Profilhülle.

Die Browserprüfungen verwenden die tatsächliche HTML-App, synthetische Fälle und abgefangene Serveranfragen. WebKit wird unter einer kontrollierten HTTP-Testadresse gestartet, um dateispezifische CORS-Fehler nicht mit Appfehlern zu vermischen. Geprüft wurden schmale Ansichten und beim Profil zusätzlich 570 px; E-Mail und Explorer enthalten Hell-/Dunkel- sowie Desktopprüfungen. Eine erneute Prüfung auf einem physischen iPhone ist damit nicht ersetzt. Diese Runde bestätigt die genannten Korrekturen, nicht eine vollständige erneute Mockup-Abnahme aller 32 Module.

Reproduktion: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright MOBILE_QA_BROWSER=webkit node server/scripts/qa-mobile-layout.cjs`. Die übrigen Abläufe stehen in `qa-mobile-navigation.cjs`, `qa-mobile-mail.cjs`, `qa-mobile-explorer.cjs` und `qa-mobile-completion.cjs` unter `server/scripts`.

[Prüfprotokolle](mobile-layoutkorrektur-v3/pruefungen)
