# Betreuungsbüro Sync — Super-Productivity-Plugin

Beidseitiger Aufgaben-Abgleich zwischen Super Productivity (ab v10, Plugin-System) und dem
Betreuungsbüro-Dokumentenassistenten über dessen `/api/ext`-Fassade (Bearer-Token).

## Was es tut

- Holt alle büroweiten Aufgaben (offen + kürzlich erledigte) und legt sie in SP an.
- „Erledigt" in SP → Erledigt-Rückmeldung an das Büro; Titel-/Datumsänderungen aus SP werden
  zurückgeschrieben, wenn die SP-Seite neuer ist (sonst gewinnt das Büro).
- **Fristen und Wiedervorlagen kommen schreibgeschützt an** (🔒-Präfix). Änderungen daran werden
  nie zurückgemeldet — der Server lehnt sie ohnehin ab (Nur-Export, Beschluss 02.08.2026).
- In SP neu angelegte Aufgaben wandern **nicht automatisch** ins Büro (bewusst: keine privaten
  Notizen im Bürosystem). `sync-core.js` bringt dafür `newSpTasks()` mit; eine Übertragen-Aktion
  kann darauf aufsetzen.

## Einrichtung

1. Im Büro-Server: Admin-Panel → API-Token anlegen (dieselben Tokens wie für die
   Browser-Extension; der Token erbt die Rechte seines Nutzers — `viewCases` zum Lesen,
   `editCases` zum Zurückmelden).
2. In Super Productivity: Einstellungen → Plugins → Plugin laden und diesen Ordner wählen
   (`manifest.json`, `plugin.js`, `sync-core.js`).
3. Beim ersten Start fragt das Plugin Server-URL + Token ab (falls die Dialog-API der
   SP-Version das hergibt — sonst einmalig in `plugin.js`/gespeicherte Plugin-Daten eintragen).
4. Abgleich: automatisch jede Minute, nach Task-Ereignissen entprellt, manuell über den
   „Büro-Sync"-Knopf in der Kopfleiste.

## Hinweise

- Die Kernlogik (`sync-core.js`) ist SP-frei und wird im Server-Prüfstand getestet
  (`server/tests/sp-plugin-core.test.cjs`).
- Die PluginAPI wächst je SP-Version; `plugin.js` prüft jede Methode vor Gebrauch und meldet
  fehlende Fähigkeiten statt zu raten. Ein kurzer Probelauf in der eigenen SP-Version gehört
  zur Einrichtung (Etappe 0/6 des Plans).
- Alternative ohne Plugin: der CalDAV-Aufgaben-Feed des Servers (`/dav-feed/<Token>/`,
  Admin-Panel → „Aufgaben-Feed (CalDAV)") funktioniert mit SPs eingebautem CalDAV-Provider —
  lesend plus Erledigt-Rückmeldung.
