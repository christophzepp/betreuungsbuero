# Mobile Menükorrektur vom 08.09.2026

Basis: Beta-Commit `a51621722f53ebd12381f0a010830fd0e4ef1177`. Anlass sind die Safari-Aufnahmen von 15:07 und 15:12 Uhr. Veröffentlichungsziel ist der Beta-Zweig `develop` mit dem automatisch gebauten Beta-Image. Ein bereits laufender lokaler Container benötigt anschließend ein Image-Update.

- Der alte KI-Fallchat-Eintrag entfällt im Mehr-Menü und im Menüeditor. Die eigentliche Funktion bleibt unter Chats erreichbar. Die technische Registry bleibt zur Ansichtserkennung erhalten.
- Start steht fest links in der unteren Leiste. Chats und Mehr bleiben ebenfalls fest. Die Standardfavoriten Übersicht, Doku und E-Mail bleiben erhalten.
- Gespeicherte lokale und serverseitige Profile werden bereinigt: Alte Start- und KI-Chat-Pins belegen keinen der acht Favoritenplätze. Die übrige Auswahl und deren Reihenfolge bleiben erhalten. Eine ausdrücklich leere Favoritenauswahl bleibt leer.
- Editor und Vorschau zeigen dieselbe Belegung; Start kann nicht abgeheftet werden. Bei vielen Favoriten scrollt nur die mittlere Reihe, während Start, Chats und Mehr erreichbar bleiben.

## Prüfung

205 mobile Codeprüfungen erfolgreich. Je 82 Menüprüfungen in WebKit und Chromium sowie 27 bestehende Fundament- und 24 Navigationsprüfungen in WebKit erfolgreich: insgesamt 215 Browserprüfungen. Geprüft wurden neue Profile, lokale Altprofile, Serverprofile, Abbrechen/Speichern, acht Favoriten, 320/390/570 px, Hell/Dunkel, beide Chat-Zugänge, Mitarbeiterchat-Badge und Entwurfsschutz beim Wechsel zu Start. Die Fundamentprüfung verwendet weiterhin die tatsächliche Mitarbeiterchat-Logik mit abgefangenem Backend.

229 ausführbare JavaScript-Blöcke syntaktisch geprüft. Alle 99 großen eingebetteten Datenblöcke und das vorhandene NUL-Byte sind unverändert. Tests verwenden synthetische Daten; keine Produktivdaten wurden verändert. Eine Prüfung auf einem physischen iPhone oder im laufenden Docker-Container wurde nicht durchgeführt.

Reproduktion: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright MOBILE_QA_BROWSER=webkit node server/scripts/qa-mobile-menu.cjs`; für Chromium `MOBILE_QA_BROWSER=chromium` setzen.

## Screenshots der tatsächlichen App in WebKit

[Start mit fester Navigation](mobile-menuekorrektur-v5/start-mit-navigation.png) · [Schnellbereiche](mobile-menuekorrektur-v5/schnellbereiche.png) · [Menüeditor](mobile-menuekorrektur-v5/menue-anpassen.png) · [Chats](mobile-menuekorrektur-v5/chats.png)

[Prüfprotokolle](mobile-menuekorrektur-v5/pruefungen)
