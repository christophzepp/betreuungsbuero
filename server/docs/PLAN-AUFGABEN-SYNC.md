# Plan: Anbindung Vikunja, OpenProject, Super Productivity (self-hosted)

Stand 02.08.2026. Ziel: Aufgaben/To-Dos beidseitig abgleichen; Kalender, Kontakte, Mails und
Dateien soweit die Dienste es tatsächlich hergeben (siehe Matrix unter B — dort ist weniger
möglich, als die Aufzählung vermuten lässt).

> **Bau-Stand 02.08.2026, abends: alle Etappen 1–6 gebaut** (Nutzerauftrag „Baue alle Phasen!",
> Etappe 0 beantwortet mit „Alles aktuell!"). Neu im Bestand:
> `server/src/integrations/tasks/{openproject,vikunja}.js` (Adapter),
> `server/src/modules/sync/{journal,hook-routes}.js`, `server/src/modules/feeds/dav-routes.js`
> (CalDAV-Feed unter `/dav-feed/<Token>/`), Fristen-Wächter + Export in
> `server/src/modules/sync/runner.js`, `/api/ext/todos`-Fassade, Admin-Panel-Karten
> (Provider, Fälle & Projekte, Statuszuordnung, Fristen-Export, Webhook, iCal-Abo,
> Sync-Protokoll, Feed-Tokens), SP-Plugin unter `sp-plugin/`.
> Prüfstände: 6 neue Testdateien (39 Tests) — `tasks-openproject-adapter`, `tasks-vikunja-adapter`,
> `sync-deadline-guard`, `feeds-dav`, `sync-hook-routes`, `sp-plugin-core`; Gesamtlauf 254 grün,
> rot ausschließlich die elf vorbestehenden Blockzahl-Tests. Offen bleibt naturgemäß der
> Probelauf gegen die ECHTEN Instanzen (Tokens/URLs trägt der Nutzer selbst im Admin-Panel ein)
> und ein SP-Probelauf des Plugins (README dort).

## A. Ausgangslage — was bereits trägt

Die Anwendung hat eine fertige Sync-Infrastruktur; die drei Neuen sind **Stecker in vorhandene
Steckdosen, kein neues Sync-System**:

| Baustein | Ort | Für die Neuen bedeutet das |
| --- | --- | --- |
| Verbindungen mit verschlüsselten Zugängen (`calendar_connections`: provider, username, password_encrypted, calendar_url, **todo_url**, task_list_id, Modi off/manuell/auto) | `server/src/database/index.js` | Vikunja-CalDAV passt **ohne Schemaänderung** hinein; OpenProject braucht nur eine neue provider-Kennung + 2 kleine Zuordnungstabellen |
| Beidseitiger **Aufgaben-Sync existiert schon** (`fetchTodos`/`pushTodo`, Dispatch nach Provider) | `server/src/modules/calendar/sync.js` | neue Provider docken an genau diese Schnittstelle an |
| CalDAV-Client inkl. **VTODO** (RFC 5545-Parser/Serialisierer) | `server/src/integrations/calendar/caldav.js` | Vikunja spricht CalDAV → Weg 1 ist fast gratis |
| `todos`-Tabelle mit `source`, `external_uid`, `external_href`, `external_etag` | Schema | Fremdschlüssel-Muster für Abgleich ist etabliert; OP legt `lockVersion` in `external_etag` |
| Kontakte-Sync mit **Import-Ablage** (bewusste Übernahme statt Auto-Merge) | `server/src/modules/contacts/sync.js` | Muster für „nichts läuft ungefragt voll" |
| Mail (IMAP/Graph, SMTP-Versand, mailbox-watch-Timer) | `server/src/modules/mail/` | Timer-/Watch-Muster für Auto-Sync wiederverwenden |
| Datei-Explorer-Mounts (WebDAV/Nextcloud, lokale Ordner) | `server/src/integrations/storage/` | Dateien-Kür in Etappe 5 |
| Admin-Panel als Verbindungs-UI (Anleitungstexte je Provider, OAuth-Callbacks) | HTML ~L34376/36271 | neue Provider bekommen dort Karte + Anleitung |

## B. Was die drei Dienste wirklich hergeben

| Bereich | Vikunja | OpenProject | Super Productivity |
| --- | --- | --- | --- |
| **Aufgaben** | ✅ beidseitig — CalDAV (VTODO) **und** REST `/api/v1` (Token) | ✅ beidseitig — REST APIv3 Work Packages, `lockVersion` = eingebaute Konflikterkennung | ⚠️ kein Server, keine API. SP **holt selbst**: eingebaute Issue-Provider für **CalDAV und OpenProject** (Import, Status-Abgleich); Plugin-System für mehr |
| **Kalender** | ⚠️ nur Aufgaben-Fälligkeiten (VTODO `DUE`), keine echten Termine | ⚠️ iCal-Abo je Projekt (nur lesen); Meilensteine/Meetings | ❌ |
| **Kontakte** | ❌ | ❌ (Nutzerkonten ≠ Kontakte) | ❌ |
| **Mails** | ❌ | ⚠️ nur eingehende Mail → Work Package/Kommentar (Instanz-Feature, falls konfiguriert) | ❌ |
| **Dateien** | ⚠️ Anhänge an Aufgaben | ✅ Anhänge an Work Packages per API | ❌ |

**Klartext:** Aufgaben sind das Herzstück. **Kontakte und Mails führt keiner der drei** — die
bleiben bei den bestehenden Google/Outlook/Nextcloud-Anbindungen. Kalender und Dateien sind
Beiwerk (lesend bzw. als Anhang, Etappe 5).

## C. Architekturentscheidungen

1. **Vikunja zuerst über die CalDAV-Schiene** (kleinster Eingriff): provider-Kennung `vikunja`
   als CalDAV-Variante — Basic-Auth mit Vikunjas CalDAV-Token, `todo_url` auf
   `…/dav/projects/<id>`, Projekt-Discovery wie bei Nextcloud. Der bestehende VTODO-Sync läuft
   dann unverändert. Später (Etappe 3) ein nativer REST-Adapter für das, was CalDAV nicht kann:
   Labels (Fall-Kennzeichen), Kanban-Spalten, Webhooks für Sofort-Sync, Kommentare.
2. **OpenProject als erste „reine" Aufgaben-Integration**: neue Adapter-Familie
   `server/src/integrations/tasks/openproject.js` hinter derselben Dispatch-Schnittstelle
   (fetch/push/complete/remove). Auth: Basic mit Benutzer `apikey` + API-Token. Änderungsabruf
   über `updatedAt`-Filter der Query-API. Schreiben mit `lockVersion` → ein 409 ist die saubere
   Konfliktmeldung. **Status-Zuordnung ist Pflicht-UI**: OP-Workflows sind je Instanz
   konfigurierbar, also kleine Zuordnungstabelle offen/erledigt ↔ Instanz-Status im Admin-Panel.
3. **Super Productivity ohne eigenen Server-Adapter** — SP holt selbst:
   - **Weg 1 (empfohlen):** unser Server bekommt einen **eigenen CalDAV-/VTODO-Feed** mit
     widerruflicher Token-URL (je Fall oder gesamt). SPs eingebauter CalDAV-Provider abonniert
     ihn; laut SP-Doku inkl. Status-Abgleich — Umfang in Etappe 0 an der echten Instanz prüfen.
     Der Feed nützt nebenbei jedem anderen CalDAV-Client.
   - **Weg 2 (gratis):** läuft OpenProject, nutzt SP seinen eingebauten OpenProject-Provider —
     SP bekommt die Aufgaben transitiv, null Aufwand bei uns. Nur dokumentieren.
   - **Weg 3 (fest eingeplant, Etappe 6):** eigenes SP-Plugin (SP hat ein Plugin-System mit
     JS-API) für echte Beidseitigkeit gegen unsere REST-API — eigenes kleines Artefakt im Repo.
   - **Ausdrücklich nicht:** SPs Sync-Datei (WebDAV) fremdbeschreiben. Internes, versioniertes
     Format — Korruptionsgefahr für die Daten des Nutzers.
4. **Datenschutz** (es sind Betreuungsdaten): Entschieden am 02.08.2026 — **Klarnamen werden
   übertragen** (alles läuft self-hosted im eigenen Haus). Der Pseudonym-Schalter
   (`[F-<Nr>]`-Titelmuster, Beschreibung nur per Opt-in) wird trotzdem je Verbindung eingebaut,
   steht aber standardmäßig aus. Bewusst in Kauf genommen: die Zielsysteme führen damit
   personenbezogene Betreuungsdaten auch in ihren eigenen Backups und Volltextsuchen.
5. **Konflikte & Löschungen**: `external_etag`/`lockVersion` + `updated_at`; Standard „letzte
   Änderung gewinnt" + Sync-Journal (nachvollziehbar, Muster Kontakte-Ablage). Löschungen werden
   **nie stillschweigend übernommen** (Voreinstellung: nachfragen). **Fristen: nur Export** —
   eingehende Änderungen an Fristen werden ignoriert und gemeldet (rechtlich kritisch).

## D. Etappen (S = ein Zug · M = größerer Zug · L = mehrere Züge mit eigenen Prüfständen)

| # | Etappe | Umfang | Prüfstein |
| --- | --- | --- | --- |
| 0 | **Versionsabgleich an den echten Instanzen**: Vikunja-Version (CalDAV-Pfad, Webhooks ab 0.22), OP-Version (APIv3, iCal-Abo aktiv?), SP-Version (CalDAV-/OP-Provider, Plugin-API, Status-Rückmeldung). API-Tokens anlegen. Ergebnisse fließen in diesen Plan zurück. | S | Checkliste in diesem Dokument abhaken |
| 1 | **Vikunja über CalDAV**: provider `vikunja`, Admin-Panel-Karte + Anleitung, Projekt-Discovery, Aufgaben beidseitig. Dazu der **Fristen-Export mit Nur-Export-Wächter** (greift ab hier für alle Provider) | S–M | Mock-CalDAV mit Vikunja-Eigenheiten (Pfade, Token-Basic) in node:test; Wächter-Test: eingehende Fristen-Änderung wird verworfen + gemeldet |
| 2 | **OpenProject Aufgaben**: Adapter, CRUD mit lockVersion, updatedAt-Delta, Status- und Fall↔Projekt-Zuordnung im Admin-Panel, optional Instanz-Webhook | M–L | Mock-APIv3 inkl. 409-Konflikt |
| 3 | **Vikunja nativ (REST)**: Label je Fall, Priorität, Opt-in-Beschreibung, Webhook-Sofort-Sync; CalDAV bleibt Rückfallebene | M | Mock-REST + Webhook-Zusteller |
| 4 | **Super Productivity, Teil 1 — Feed**: eigener VTODO-Feed mit widerruflicher Token-URL + SP-CalDAV-Provider einrichten; SP↔OP-Weg dokumentieren | S–M | Feed gegen den eigenen CalDAV-Client testen (rund läuft: unser Client liest unseren Feed) |
| 5 | **Kür — Kalender & Dateien**: OP-iCal lesend in den Kalender; „Dokument als Anhang an Aufgabe/Work Package senden" als bewusste Einzelaktion (verknüpfen statt spiegeln); mobile Ansicht der neuen Einstellungen | M | ICS-Fixtures; Mobil über den Offline-Prüfstand |
| 6 | **Super Productivity, Teil 2 — Plugin** (fest eingeplant): beidseitiger Abgleich gegen unsere REST-API, eigenes JS-Artefakt im Repo, Installation im Handbuch dokumentiert | L | Plugin-Logik gegen einen Mock unserer REST-API in node:test |

## E. Spielregeln der Codebasis (gelten unverändert)

- **Blockzahlen 287/212/173 bleiben**: UI-Zusätze in bestehende Script-/Style-Blöcke; alles
  Schwere liegt in `server/src` (dort frei).
- Tests offline: Mock-HTTP-Server in node:test, kein Netz. Maßstab ist der
  Vorher-/Nachher-Vergleich (aktuell 237 grün, 11 vorbestehend rot).
- Desktop-Ansicht unangetastet; neue Einstellungsflächen mobil über den Prüfstand kontrollieren.

## F. Entscheidungen (Nutzer, 02.08.2026)

1. **Fall-Abbildung:** ein Projekt je Fall — in Vikunja wie OpenProject.
2. **Pseudonymisierung:** aus. Klarnamen werden übertragen; der Schalter je Verbindung wird
   eingebaut und bleibt Opt-in (siehe C.4).
3. **Umfang:** Aufgaben beidseitig **und** Fristen als strikter Nur-Export — eingehende
   Änderungen an Fristen werden verworfen und gemeldet.
4. **Super Productivity:** Feed **und** Plugin, beides fest eingeplant (Etappen 4 und 6).
5. **Konfliktregel:** letzte Änderung gewinnt + Sync-Journal; Löschungen nur mit Nachfrage
   (Standard, unwidersprochen).

## G. Feldabbildung (Referenz für die Adapter)

| lokal (`todos`) | Vikunja CalDAV | Vikunja REST | OpenProject |
| --- | --- | --- | --- |
| `title` (ggf. pseudonymisiert) | SUMMARY | `title` | `subject` |
| `description` (Opt-in!) | DESCRIPTION | `description` | `description.raw` |
| `due_at` | DUE | `due_date` | `dueDate` |
| `done` | STATUS:COMPLETED | `done` | Status laut Zuordnungstabelle |
| `priority` | PRIORITY 1–9 | `priority` 0–5 | `_links.priority` |
| `external_uid` | UID | `id` | `id` |
| `external_etag` | ETag | `updated` | **`lockVersion`** |
| Fall | Projekt laut Zuordnung | Projekt/Label laut Zuordnung | Projekt laut Zuordnung |
