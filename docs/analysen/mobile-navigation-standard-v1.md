# Mobile Navigation: verbindlicher Standard

Umgesetzt am 07.09.2026. Diese Regeln ersetzen die zwischenzeitlich dauerhaft sichtbare Navigation des mobilen Fundaments.

1. **Abwärts scrollen:** Nach einer kurzen Strecke blendet sich die Navigation aus.
2. **Aufwärts scrollen:** Sie erscheint zügig wieder.
3. **Seitenanfang und Öffnen eines Menüs:** Die Navigation ist sichtbar.
4. **Bildschirmtastatur geöffnet:** Die Navigation wird vollständig ausgeblendet. Nach Tastaturschluss erscheint sie wieder.

Die gemeinsame Regel gilt auch in Formularen und im Mitarbeiterchat. Sie wird zentral in der mobilen Shell umgesetzt. Bestehende Favoriten, Chats und Mitarbeiterchat-Badges bleiben erhalten. Bereits eigenständig im Vollbild laufende Oberflächen erhalten dadurch keine zusätzliche Navigation.

## Verhalten im Detail

- Abwärts werden 40 px Bewegung gesammelt; ausgeblendet wird erst außerhalb des Anfangsbereichs. Aufwärts reichen 18 px. Richtungswechsel setzen die gesammelte Strecke zurück.
- Eine Sperrfrist von 250 ms verhindert Flackern. Ein bereits abgeschlossener Richtungswechsel wird anschließend auch ohne weiteres Scrollereignis übernommen.
- Die obersten 28 px zeigen die Leiste sofort. Tastatur und offene Auswahlblätter haben Vorrang vor der Scrollsteuerung.
- Es zählen Scrollereignisse aus der aktiven Oberfläche. Hintergrundseiten, Eingabefelder und die Blätter der Navigation steuern sie nicht.
- Beim Scrollen ändern sich weder die Größe des Inhaltsbereichs noch die Position seiner Aktionsleiste. Die Platzreserve bleibt bestehen; die Navigation bewegt sich darüber. Der Hintergrund des aktiven mobilen Moduls bleibt deckend.
- Unsichtbare Navigationselemente sind nicht anklickbar oder per Tastatur fokussierbar. Reduzierte Bewegung wird berücksichtigt.
- Die Tastaturerkennung berücksichtigt sowohl einen verkleinerten sichtbaren Viewport als auch einen verkleinerten Layout-Viewport. Browserleisten, Pinch-Zoom und alleiniger Eingabefokus gelten nicht als geöffnete Bildschirmtastatur.
- Bei geöffneter Tastatur entfällt die Platzreserve der Navigation. Die Aufgaben-, Dokumentations- und Chataktionen bleiben oberhalb der Tastatur erreichbar.

## Prüfung

- **78 gezielte Tests erfolgreich**, einschließlich Verhalten, Scrollprüfung, Tastaturpriorität, Mobilansichten, Dokumentation und JavaScript-Syntax der ausgelieferten HTML-App.
- **23 Browserprüfungen** der neuen Navigation: Aufgabenliste und -formular, Dokumentationsliste und -formular, Mitarbeiterchat, Abbruch des Ausblendens, kleine Bewegungen, unveränderte Geometrie, Menüwechsel, Tastatur, Zoom und Desktop.
- Zusätzlich laufen die **42 Browserprüfungen des Aufgaben-Piloten** und die bestehende Browserprüfung des mobilen Fundaments erfolgreich durch.
- Falldaten, Aufgaben und Nachrichten sind simuliert; externe Verbindungen werden abgefangen. Tastaturprüfungen verwenden kontrollierte Viewport-Geometrien. Eine Prüfung auf physischen Smartphones ist damit nicht ersetzt.

Reproduktion: `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright node server/scripts/qa-mobile-navigation.cjs`.

[Navigation sichtbar](mobile-navigation-standard-v1/navigation-sichtbar.png) · [Navigation ausgeblendet](mobile-navigation-standard-v1/navigation-ausgeblendet.png) · [Browserprotokoll](mobile-navigation-standard-v1/browser-pruefung.txt) · [Gezielte Tests](mobile-navigation-standard-v1/gezielte-tests.txt)

Die Umsetzung liegt lokal in der ausgelieferten HTML-App und ist noch nicht veröffentlicht.
