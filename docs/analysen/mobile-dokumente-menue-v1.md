# Dokumente im mobilen Menü

Stand: 09.09.2026. Ergänzung zum mobilen Dokumenteneditor für den Beta-Zweig `develop`.

## Bedienung

„Dokumente“ ist als eigener Menüpunkt unter „Mehr“ freigegeben. Die Standardposition liegt vor dem Datei-Explorer. Der neue Bereich verwendet die Kennung `report-library`; die bestehende Explorer-Kennung `documents` und alle gespeicherten Explorer-Favoriten bleiben unverändert.

- Sortierbar im Mehr-Menü und als einer der acht zusätzlichen Favoriten in der unteren Leiste anheftbar. Start und Chats bleiben weiterhin sortierbar.
- Bestehende Nutzerprofile erhalten den neuen Eintrag in der Menüauswahl. Ihre Favoriten und die relative Reihenfolge aller bisherigen Menüpunkte bleiben erhalten.
- Die Dokumentauswahl nutzt unmittelbar `REPORTS` und `REPORT_GROUPS`: alle 89 registrierten Dokumenttypen werden angeboten, ebenso später registrierte eigene Formulare. Keine zweite statische Dokumentliste.
- Suche nach Dokumenttitel und Kategorie, Filter nach Kategorie einschließlich Unterkategorien, Trefferzahl und Leerzustand. Die vorhandene Kennzahl zeigt den Füllstand der Pflichtfelder, keine Freigabe oder fachliche Vollständigkeit.
- Ein Dokument öffnet den bestehenden mobilen Editor. Die Rechnungslegung nutzt ihre bisherige eigene mobile Oberfläche.
- Zurück führt zur Dokumentauswahl und erhält Suche, Filter und Scrollposition. Dieser Rückweg ist auch in der Hauptansicht der Rechnungslegung vorhanden; deren interne Rückwege bleiben erhalten.
- Der bestehende Schutz bei noch nicht geladenem Fall bleibt wirksam. Beim Wechsel zur Desktopbreite wird die mobile Auswahl geschlossen.

Die vollständigen Bearbeitungs- und Exportfunktionen liegen weiterhin in den jeweiligen Dokumenteneditoren. „Dokumente“ ist der Einstieg für Dokumentvorlagen und Arbeitsfassungen; der Datei-Explorer enthält weiterhin die Dateien und Ordner.

## Prüfung

| Prüfung | Erfolgreich |
|---|---:|
| Dokument-Menüabläufe in WebKit | 26 |
| Dokument-Menüabläufe in Chromium | 26 |
| Bestehende Menü-/Favoritenabläufe in WebKit | 105 |
| Bestehende und aktualisierte Codeprüfungen | 30 |
| Syntax ausführbarer Inline-Skripte | 231 |

Geprüft: getrennte Menüeinträge für Dokumente und Explorer, Anheften und Sortieren, Speicherung der Präferenzen, vollständige Dokumentliste, Suche, Kategorien mit Unterkategorien, Filterabbruch und Zurücksetzen, kein Treffer, Öffnen aus Start, bestehender Fall-Ladeschutz, Bearbeitung und Rückkehr, Rechnungslegung, Scrollposition, eigene Formulare, 320/390/570 Pixel in Hell/Dunkel und Desktopwechsel. Keine JavaScript-Laufzeitfehler.

Die Browserprüfung verwendet die ausgelieferte HTML-App, synthetische Testfälle und abgefangene APIs. Kein produktiver Schreibvorgang, kein Test auf einem physischen iPhone. Alle 99 langen eingebetteten Zeichenblöcke und das vorhandene NUL-Byte sind gegenüber der Git-Basis `b4dfffc` erhalten.

Reproduktion: `server/scripts/qa-mobile-documents.cjs` sowie `server/scripts/qa-mobile-menu.cjs`, mit `PLAYWRIGHT_MODULE`, optional `MOBILE_QA_BROWSER=webkit`, und `MOBILE_QA_OUTPUT`. Die 30 Codeprüfungen: `html-mobile-nav-favorites`, `html-mobile-module-views`, `html-mobile-accounting` unter `server/tests`.

[Ansichten öffnen](mobile-dokumente-menue-v1/index.html) · [WebKit](mobile-dokumente-menue-v1/pruefungen/browser-webkit.txt) · [Chromium](mobile-dokumente-menue-v1/pruefungen/browser-chromium.txt) · [Menüregression](mobile-dokumente-menue-v1/pruefungen/menue-regression-webkit.txt)
