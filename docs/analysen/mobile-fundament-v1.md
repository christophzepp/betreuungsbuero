# Mobiles Fundament und Chats – erste Umsetzung

Stand: 07.09.2026. Ausgangspunkt: GitHub `origin/main`, v0.7.7, Commit `9b28c434343743b116da66f37cb88d0b7cbc2019`. Arbeitsbranch: `codex/mobile-foundation-chats`.

Fortschreibung: Für die Sichtbarkeit der unteren Navigation gilt inzwischen der [bestätigte Standard mit Scrollrichtung und Tastaturvorrang](mobile-navigation-standard-v1.md).

## Umsetzung

Die ausgelieferte HTML-App enthält gemeinsame mobile Farben, Kopfzeilen, Inhaltsbereiche, Listenzeilen, Formularfelder, Filterblätter und Aktionsleisten. Sie greifen ausschließlich im bestehenden Smartphone-Profil `mobile-online-active`. Die Dokumentation verwendet diese Bausteine als Referenz. Die übrigen Fachmodule können daran schrittweise angeschlossen werden; ihre individuellen Formulare und Filter wurden in dieser Etappe nicht neu aufgebaut.

Der feste Zugang **Chats** öffnet das freigegebene Auswahlblatt mit **Mitarbeiterchat** und **KI-Fallchat**. Standardnavigation: Chats, Übersicht, Doku, E-Mail, Mehr. Der verschiebbare Mitarbeiterchat-Kreis verschwindet auf dem Smartphone; am Desktop bleibt er bestehen. Der Badge zeigt ungelesene Mitarbeiternachrichten, ab 100 als `99+`; bei null wird er ausgeblendet. Die Chat-Liste allein markiert keine Unterhaltung als gelesen.

Die bestehenden Navigationskennungen und alle 32 mobilen Einträge bleiben erhalten. Der bisherige KI-Favorit wird durch Chats abgedeckt. Beim Bearbeiten der Favoriten wird dafür kein separater Platz mehr benötigt. Bis zu acht weitere Favoriten bleiben möglich, bei Bedarf in einer horizontal scrollbaren Reihe zwischen den beiden festen Zugängen. Das Format der lokal und serverseitig gespeicherten Einstellungen bleibt gleich.

## Erhaltene Funktionen

| Bereich | Weiter verwendete Funktionen |
| --- | --- |
| Dokumentation – Liste | Fallwechsel, Suche, Wochen-/Monatskalender, Tagesauswahl, Sortierung, Filterchips und die fünf Filter Jahr/Bereich/Themenfeld/Kontaktart/Quelle |
| Dokumentation – Exporte | Übersicht als PDF, Auswahl mit Inhalten als PDF, Übertragung nach Excel – jetzt auch über einen sichtbaren mobilen Exportknopf erreichbar |
| Dokumentation – Details | Blättern, Bearbeiten, PDF, Anlagen-ZIP bei vorhandenen Anlagen, Löschen, Excel-Zeile |
| Dokumentation – Formular | Sämtliche Originalfelder, Regel-/KI-Vorschläge, Foto/Datei/Aufnahme, Berichtsziel-Felder, Excel-Vorschau, Speichern, Abbrechen und Schutzabfrage |
| Mitarbeiterchat | Gespräche, Kontakte, Suche, Direktnachrichten, Gruppen, Präsenzstatus, ältere Nachrichten, Lesestatus, Dateianlagen und Downloads, Fall-/Dokumentverweise, Erwähnungen und gemeinsame KI-Beiträge |
| Mitarbeiterchat – mobile Ergänzungen | Ungelesen-Filter, benannte Touch-Schaltflächen für Erwähnen/Verknüpfen/KI, Rückweg zur vorher geöffneten Ansicht, getrennte Gesprächsentwürfe |
| KI-Fallchat | Vorhandene KI-Oberfläche einschließlich Einstellungen, Kontext, Unterhaltungen, Anlagen und Eingabe; eigener vorübergehender Dialog erhält das vorherige Formular |
| Gemeinsame Navigation | Alle bestehenden Bereiche, Favoriten, Reihenfolge, Menüanpassung, Benutzerzugang und bisherige Auswahlwege für Datei/Kamera/Aufnahme |

Die Fachfunktionen und ihre Server-Endpunkte werden weiterverwendet. Es gibt keine zweite mobile Implementierung der Speicher-, Export- oder Chat-Logik. Ein KI-Ausflug bewahrt das bisherige Dialogelement als echten DOM-Knoten auf. Dadurch bleiben auch Formularwerte, Dateiauswahl, Ereignisverknüpfungen und modulinterner Entwurfszustand erhalten. KI-Entwürfe sind an die jeweilige Unterhaltung gebunden.

## Schnittstelle für die nächsten Module

Die bestehende mobile Shell stellt `window.__mobileUI` bereit:

```js
const view = __mobileUI.createView({
  kind: 'form', // ebenso 'list' und 'detail'
  title: 'Aufgabe bearbeiten',
  subtitle: fallname,
  body: vorhandenesFormularElement,
  onBack: vorhandeneAbbruchpruefung,
  actions: [],
  footer: [{ label: 'Speichern', primary: true, onClick: vorhandenesSpeichern }]
});
ziel.append(view.root);
```

`createView` liefert `root`, `header`, `content` und `actionBar`. Übergebene DOM-Knoten werden übernommen und nicht geklont. Ein Modul behält seine Validierung, Rechteprüfung und Abbruchlogik. `button` erzeugt beschriftete Schaltflächen; `openSheet`/`closeSheet` stellen Auswahlblätter bereit; `openFilter` ergänzt feste Rücksetz-/Anwenden-Aktionen. Bei `onApply() === false` bleibt das Filterblatt zur Korrektur offen. Abgelehnte asynchrone Aktionen zeigen eine Fehlermeldung. `adoptDocumentation` verbindet die vorhandene Dokumentation mit den gemeinsamen Klassen.

Die Mitarbeiterchat-Schnittstelle ergänzt `getState()` und `close()`. Das Ereignis `userChatStateChanged` enthält nur Verfügbarkeit, Anzahl ungelesener Nachrichten/Gespräche und Öffnungszustand. Der Badge liest diese Metadaten; Nachrichteninhalte werden darüber nicht verteilt.

Für jeden weiteren Modulumbau müssen vorab alle Aktionen, Filter, Formularfelder, Unteransichten und Sonderzustände des konkreten Moduls erfasst und anschließend geprüft werden. Das gemeinsame Fundament ersetzt diese fachliche Zuordnung nicht.

## Prüfung

- 65 gezielte Mobil- und Dokumentationsprüfungen erfolgreich.
- Browserprüfung führt die echte ausgelieferte HTML-App aus. Falldaten und Chat-API sind vollständig simuliert; es werden keine echten Nachrichten versandt.
- Geprüft: Auswahlblatt, Filter und Exporte, Badge-Zählung, getrennte Entwürfe, Fehler beim Senden, Original-DOM und Schutzabfrage nach beiden Chat-Rückwegen, Breiten 320/360/390/430 px, Hell/Dunkel, gemeinsame Formular-/Filter-Schnittstelle, acht Favoriten, geringe Bildschirmhöhe, nicht verfügbarer Mitarbeiterchat sowie Desktop-Verhalten.
- Vollständige Testsuite: 1.215 Prüfungen, davon 1.211 erfolgreich, drei fehlgeschlagen und eine übersprungen. Die drei Fehler sind auf einer unveränderten Kopie desselben Release-Commits reproduziert: `backup-table-registry`, `recovery-bootstrap` (zusätzliche Spalte `office_ai_config.allowed_models`) und `html-v230-print-golden` (PDF-Seitenrendering).
- Die Tastaturfläche wird über `visualViewport` berücksichtigt. Ein Test auf einem physischen iPhone/Android-Gerät und ein Mehrbenutzertest mit echten Konten stehen vor der Veröffentlichung noch aus.

Reproduzierbar über `server/scripts/qa-mobile-foundation.cjs` mit installiertem Playwright bzw. `PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright`. Die gezielten Prüfungen liegen in `server/tests/html-mobile-*.test.cjs` und `server/tests/falldokumentation-excel-vorschau.test.cjs`.

Die Änderung ist lokal umgesetzt; sie wurde nicht veröffentlicht.

## Ansichten und Prüfprotokolle

- [Chats-Auswahl](mobile-fundament-v1/chats-auswahl.png) und [dunkle Darstellung](mobile-fundament-v1/chats-dunkel-360.png)
- [Gesprächsliste](mobile-fundament-v1/mitarbeiterchat-liste.png) und [Unterhaltung](mobile-fundament-v1/mitarbeiterchat-unterhaltung.png)
- [Dokumentationsfilter](mobile-fundament-v1/dokumentation-filter.png) und [Formular nach Chat-Rückkehr](mobile-fundament-v1/formular-nach-chat.png)
- [Browserprüfung](mobile-fundament-v1/browser-pruefung.txt), [65 Mobilprüfungen](mobile-fundament-v1/mobil-tests.txt), [Gegenprüfung der drei Fehler im unveränderten Release](mobile-fundament-v1/baseline-fehler.txt)
