# Mobile Ablaufkorrekturen vom 08.09.2026

Ausgangspunkt sind die sechs Rückmeldungen und Safari-Aufnahmen vom 08.09.2026, 14:01–14:07 Uhr. Geprüfte Basis: `6bb0da696742cf144647a14ba8255873b58032ae`. Veröffentlichungsziel ist der Beta-Zweig `develop` mit dem automatisch gebauten Beta-Image. Ein bereits laufender lokaler Container benötigt anschließend ein Image-Update.

[Screenshots der korrigierten Ansichten](mobile-ablaufkorrektur-v4/index.html)

## Änderungen

| Rückmeldung | Korrektur |
| --- | --- |
| Wiedervorlagen → Übersicht | Die Wiedervorlagenliste erhält einen sichtbaren Zurückpfeil zur Fallübersicht. Der Weg über den unteren Menüpunkt „Übersicht“ wird ebenfalls geprüft. |
| Mail-Assistent erst nach langem Scrollen erreichbar | „KI-Assistent“ steht neben „Antworten“ und „Weiterleiten“ in der festen Nachrichtenfußleiste. Er öffnet eine eigene mobile Ansicht zur aktuellen Nachricht. Zurück führt zur Mail an der vorherigen Scrollposition. |
| Ungünstige KI-Buttons | Die Eingabe steht über einer Werkzeugzeile mit Senden rechts. Schnellaktionen sind aufklappbar und verwenden verständliche Namen in zwei Spalten. Weitere Aktionen sowie Hinzufügen und Sortieren bleiben über „Verwalten“ erreichbar. Dateien, Fallkontext, Spracheingabe, Websuche, Darstellung und Einstellungen bleiben zugänglich. |
| Fehlende Kalenderwoche | Die Wochenüberschrift zeigt die ISO-Kalenderwoche; Jahreswechsel sind ausdrücklich geprüft. |
| Eintragsarten nicht kombinierbar | Vier unabhängige Auswahlfelder für Termine, Aufgaben, Fristen und Wiedervorlagen ersetzen die Einfachauswahl. Fall, Kalender und Schlagwort bleiben kombinierbar. Erst „Anwenden“ übernimmt die Auswahl; Zurücksetzen aktiviert wieder alle Eintragsarten. Auch eine leere Auswahl ist möglich. |
| Kalender öffnet Aufgaben/Wiedervorlagen zum Bearbeiten und verliert den Rückweg | Antippen öffnet zunächst die vorhandene Detailansicht mit dem Hinweis „Aus dem Kalender“. Bearbeiten ist eine eigene Aktion. Abbrechen oder Speichern führt zur Detailansicht; deren Zurückpfeil führt zum Kalender mit erhaltenem Zeitraum, Filtern und Scrollposition. Statuswechsel und Löschen berücksichtigen ebenfalls diesen Ursprung. |

Ein zusätzlicher gemeinsamer Fehler wurde bei der Browserprüfung behoben: Das Fokussieren einer Schaltfläche blendete die Navigation bereits vor dem Klick ein und konnte dadurch die Schaltfläche unter dem Zeiger verschieben. Pointer-Fokus löst dieses Verschieben nicht mehr aus; Tab-Navigation blendet die Leiste weiterhin ein. Die vier vereinbarten Regeln bleiben erhalten: abwärts ausblenden, aufwärts einblenden, am Seitenanfang/bei Ansichtswechsel anzeigen, bei Bildschirmtastatur ausblenden.

Die KI-Eingabe wird über Neuzeichnen und Ansichtswechsel erhalten. Eine weitere Frage wird beim Drücken von Enter während einer laufenden Antwort nicht mehr verworfen. Der Wechsel über „Chats“ erhält die Mail-KI-Eingabe ebenfalls. KI-Antworten lassen sich weiterhin als E-Mail-Entwurf übernehmen.

## Prüfung

- 205 mobile Codeprüfungen erfolgreich.
- WebKit: 57 Kalender-, 53 Mail-, 42 Aufgaben-, 24 Navigations- und 32 gezielte Ablaufprüfungen erfolgreich.
- Chromium: dieselben 32 gezielten Ablaufprüfungen erfolgreich. Insgesamt 240 Browserprüfungen.
- 229 ausführbare JavaScript-Blöcke syntaktisch geprüft; alle 99 großen eingebetteten Datenblöcke und das vorhandene NUL-Byte blieben gegenüber der Basis unverändert.
- Sichtprüfung der neuen Ansichten anhand der WebKit-Screenshots. Schmale Breiten, Hell/Dunkel, simulierte Bildschirmtastatur und bestehende Desktopansichten werden in den jeweiligen Browserprüfungen berücksichtigt.

Die Tests laden die tatsächliche HTML-App mit synthetischen Fällen, Aufgaben und Nachrichten. Serveranfragen und KI-Antworten werden kontrolliert abgefangen; es werden keine echten E-Mails versendet und keine Produktivdaten verändert. Die Tastaturprüfung simuliert den verkleinerten Visual Viewport. Ein physisches iPhone und der laufende Docker-Container wurden in dieser Runde nicht geprüft. Diese Prüfung betrifft die gemeldeten Abläufe und die genannten Regressionen, keine erneute vollständige Abnahme aller 32 Module.

Reproduktion: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright MOBILE_QA_BROWSER=webkit node server/scripts/qa-mobile-workflow-fixes.cjs`. Für Chromium `MOBILE_QA_BROWSER=chromium` setzen. Die ergänzenden Suiten sind `qa-mobile-calendar.cjs`, `qa-mobile-mail.cjs`, `qa-mobile-tasks.cjs` und `qa-mobile-navigation.cjs` unter `server/scripts`.

[Prüfprotokolle](mobile-ablaufkorrektur-v4/pruefungen)
