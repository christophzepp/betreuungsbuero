# Befund: Optik & Bedienvorbilder für den Formulareditor

Alle Zeilenangaben beziehen sich auf `outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html`.

## (1) Maßgebliche Optik

### CSS-Variablen (Zeile 8–12, erster `<style>`-Block)

```css
:root{
  --blue:#1f4e78;--blue2:#2f6e9f;--blue-soft:#eaf2f8;--ink:#1f2933;--muted:#66737f;
  --line:#c9d3dc;--paper:#fff;--bg:#eef2f5;--ok:#237a3b;--warn:#a36400;--bad:#b3261e;
  --ai:#8a4fb3;--prev:#2f6f91;--manual:#66737f;--master:#237a3b;
}
```

| Rolle | Wert |
|---|---|
| Primärfarbe (Dunkelblau, Überschriften/Buttons) | `#1f4e78` (`--blue`), Hover `#2f6e9f` (`--blue2`) |
| Seitenhintergrund | `#eef2f5` (`--bg`) |
| Kartenflächen | `#fff` (`--paper`, `.card`-Hintergrund) |
| Ränder/Linien | `#c9d3dc` (`--line`), Karten teils `#d3dce3`, weiche Ränder `#cfdae1` |
| Akzent hell | `#eaf2f8` (`--blue-soft`) |
| Erfolg | `#237a3b` (`--ok`/`--master`) |
| Warnung | `#a36400` (`--warn`), Fehler `#b3261e` (`--bad`) |
| KI-Kennzeichen | `#8a4fb3` (`--ai`) |
| Text | `#1f2933` (`--ink`), gedämpft `#66737f` (`--muted`) |
| Schrift | `Arial,Helvetica,sans-serif`, Grundgröße `14px` (Zeile 15) |

### Zentrale Stilregeln (Zitate)

**.btn / .btn.secondary / .btn.light** (Zeile 36–37):
```css
.btn{border:0;border-radius:8px;background:var(--blue);color:#fff;padding:10px 14px;font-weight:700}
.btn:hover{background:var(--blue2)}
.btn.secondary{background:#66737f}
.btn.light{background:var(--blue-soft);color:var(--blue);border:1px solid #bdd0df}
.btn.danger{background:#a33c35}
```
Im Admin-Panel kompakter: `.admin-shell .btn{padding:7px 14px;font-size:12.5px}` (Zeile 37424).

**.doc-info-grid / .doc-info-note** (Zeile 206):
```css
.doc-info-grid{display:grid;grid-template-columns:170px 1fr;gap:9px 16px;margin-top:8px}
.doc-info-grid dt{font-weight:700;color:#526676}
.doc-info-grid dd{margin:0;overflow-wrap:anywhere}
.doc-info-note{margin-top:16px;padding:12px 14px;border-radius:9px;background:#eef4f7;border:1px solid #cfdae1;color:#344b5c;line-height:1.45}
```

**.export-options-card / .export-mode-check** (Zeile 1233–1262):
```css
.export-options-card{margin-top:16px;padding:14px;border:1px solid #cfdae1;border-radius:10px;background:#f6f9fb}
.export-options-card h3{margin:0 0 10px;color:#244f6d;font-size:15px}
.export-mode-check{display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid #dbe4e9;border-radius:8px;background:#fff}
.export-mode-check input{margin-top:2px;accent-color:#2a648b}
.export-mode-check strong{display:block;font-size:12px;color:#324e61}
.export-mode-check small{display:block;color:#6e7e89;line-height:1.35;margin-top:2px}
```

**.main-label** (Zeile 213, im Formularblatt-Kontext):
```css
.field label.main-label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:#35434e;margin-bottom:4px}
```
Dazu Formularsektionen: `.section h2{background:var(--blue);color:#fff;font-size:15px;padding:8px 11px}`, `.field-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px 14px}`, Eingaben `border:1px solid #aebcc7;border-radius:6px;background:#f9fbfc`.

**.source-badge** (robuste Fassung Zeile 304ff, überschreibt Zeile 214/278):
```css
.source-badge{display:inline-grid!important;place-items:center!important;min-width:20px!important;height:20px!important;
  padding:0 6px!important;border-radius:999px!important;font:700 9px/20px Arial,Helvetica,sans-serif!important;
  color:#fff!important;white-space:nowrap!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)!important}
```
Farbklassen (Zeile 214): `.source-master{background:var(--master)}` `.source-manual{background:var(--manual)}` `.source-ai{background:var(--ai)}` `.source-previous{background:var(--prev)}` `.source-empty{background:#aeb6bd}`.

## (2) Bedienvorbilder

### Dateinamen-Engine (`<script id="export-name-templates-v1">`, Zeile 36564–37251)

- Vorlagen sind **reine Textzeilen mit GROSS geschriebenen Bausteinwörtern** (JJMMTT, NACHNAME, VORNAME, AZ, DOKUMENT …), keine Drag&Drop-Chips. Priorität: eigene Wahl (`bueroLocal.fileNameTemplates`) > Büro-Vorgabe (`ui_prefs.fileNameTemplates`) > Standard.
- **Baustein-Chips sind Hover-Erklärungen**: `tokChip(name)` (Zeile 36867) rendert `<span class="fntpl-tok" title="…" tabindex="0" style="font-weight:700;border-bottom:1px dotted #8a97a1;cursor:help">NAME</span>`; die Erklärtexte stehen im Objekt `TOK_HELP` (Zeile 36836ff, ~30 Bausteine). `legendTokens()` reiht sie mit `·` als Legende.
- **UI-Aufbau** `window.__exportNameDetailsHTML(scope)` (Zeile 36877): eine zugeklappte `<details data-fntpl-details>` mit `<summary>` „Dateinamen im Einzelnen anpassen (N Dateitypen)", darin je Dateityp eine Flex-Zeile: Label + `<input data-fntpl="scope:id">` (Monospace `ui-monospace,Menlo,monospace`, `border:1px solid #c9d3dc;border-radius:7px`, `oninput=__fnTplPreview` `onchange=__fnTplSave`) + Button „Standard" (`border:1px solid #cdd9e3;background:#fff;border-radius:7px`) + graue Live-Beispielzeile `[data-fnex]` mit `→ Beispieldateiname`.
- Speichern: sofort per `__fnTplSave` — office-Scope via `PUT /api/office-json/ui_prefs`, user-Scope via `saveBueroLocal()`; danach `toast(...)`.
- Einbau: Nutzer-Scope in „Export- und Versandkonten" (Zeile 8055), Büro-Scope in der Admin-Karte `window.__fileNameStyleAdminCardHTML()` (Zeile 72763ff): `.card` mit h3 „Dateinamen bei Exporten (büroweite Vorgabe)", Radio-Grid (`repeat(auto-fit,minmax(210px,1fr))`) für den Stil, darunter die Details-Liste.

### Betreff-Editor (Zeile 37150–37251, im selben Skriptblock)

- `betreffWerkzeugHTML(feldId,ohneFormat)` (Zeile 37192): eine Chip-Leiste `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin:3px 0 6px">` mit **klickbaren Baustein-Buttons** — je Token aus `BETREFF_TOKEN_LISTE` (NAME, VORNAME, NACHNAME, PERSON, GEBURTSDATUM, AZ, GERICHT, DOKUMENT, DATUM, JAHR, ZEITRAUM, BUERO, BETREUER) ein `<button title="Hilfe" onclick="__betreffChipEinfuegen('TOK','feldId')">` im Knopfstil `betreffKnopfStil()` = `border:1px solid #cdd9e3;background:#fff;border-radius:7px;padding:2px 8px;font-size:11.5px;color:#33566f`, Chips zusätzlich Monospace 10.5px. Davor drei Formatknöpfe **F/K/U** (`__betreffFormat('**'|'*'|'__')`) plus vertikaler Trennstrich.
- `betreffEditorEinbauen(id)` (Zeile 37204): hängt sich in den Dokumentinfo-Dialog — sucht `#docExportSubject`, ersetzt das Feld-`innerHTML` durch: Label „Standardbetreff" + Werkzeugleiste + Monospace-`<input data-betreff-id data-betreff-modus>` mit `oninput=__betreffVorschau` + Live-Vorschau-`<div id="docBetreffVorschau">` (12px, `#5c6d78`) + Zeile mit „Standard"-Knopf und Hinweistext (11px, `#8a97a1`) + optional gelbe Fixierungs-Box (`border:1px solid #e3cf9d;background:#fdf6e0`). Installiert per Wrapper um `window.showDocumentInfo` (Zeile 37244ff).
- Standardmuster: `BETREFF_STD='Betreuung NAME – DOKUMENT – Az. AZ'`; Speicherung `ui_prefs.subjectTemplates` bzw. `bueroLocal.subjectTemplates`.
- Wiederverwendung in Phase 3 (Export): `window.__betreffWerkzeugHTML('phase3Subject')` (Zeile 11166/22644) — die Leiste ist als Funktion für beliebige Zielfelder gebaut. **Gutes Muster für den Formulareditor** (Chips klicken → Einfügen an Cursorposition + Live-Vorschau).

## (3) Natürlicher Einstieg für „Formulare verwalten"

### Admin-Panel (`<script id="admin-panel-script-v1">`, Zeile 37508ff)

- Öffnet sich im **generischen `#modal`** (Kommentar Zeile 37513: bewusst derselbe Dialog wie alle Einstellungs-/Verwaltungsdialoge). `openAdminPanel()` (Zeile 37533): `modalTitle.textContent='Admin-Panel'`, `modalBody.innerHTML=adminShellHTML()`, dann `renderActiveTab()`.
- **Struktur** `adminShellHTML()` (Zeile 37584): `.admin-shell` = Grid `200px minmax(0,1fr)`, links `.admin-nav` (sticky Spalten-Nav mit Gruppentiteln `.admin-nav-group`, Feather-Icons 15px aus `ADMIN_ICON`), rechts `.admin-content` mit `.admin-content-head` (blaue `h3` + graue `.admin-head-sub`-Erklärzeile + `.head-actions` rechts per `margin-left:auto`, z. B. Button „Neuen Nutzer anlegen").
- **Navigation** `ADMIN_NAV_GROUPS` (Zeile 37569): Gruppe „Verwaltung" (users, cases, dataadmin, localmode, mcpremote, extension, audit) und Gruppe „Einstellungen" (office, signatures, suggestions, caldav, send, mail, ai, prompts, maps, docs, banking). Tab-Wechsel über `window.__adminPanel.switchTab(id)`; aktiver Eintrag `.admin-nav button.active{background:#eaf2f8;border-color:var(--blue);color:var(--blue)}`.
- **Natürlicher Einstieg**: ein neuer Tab z. B. `['forms','Formulare']` in der Gruppe „Einstellungen" (neben `prompts`/`suggestions`, die dasselbe Muster „büroweite Vorgaben pflegen" haben) — plus optional ein Sidebar-Shortcut.
- **Sidebar-Muster** (statisches Markup Zeile 4620–4690): `.sidebar-bottom` enthält `<details class="ai-direct-menu">`-Gruppen „Fallakte", „Fallorganisation", „Einstellungen" (`data-group-verbindungen`), „Büroorganisation" (`data-group-buero`). Deren Inhalte werden dynamisch einsortiert über die Matcher-Liste ab Zeile 26510 (`bodySelector:'[data-group-body="verbindungen"]'` bzw. `"buero"`). Vorbild-Button: „Online-Formulare" (Zeile 59453) — `<button class="service-accounts-btn" data-online-forms-menu onclick="window.openOnlineFormsModal()">` mit `nav-icon-svg` + Zähler-`.ai-status-indicator`.

### Kopf des Dokumentenbereichs / Dokumentliste

- `<nav id="nav" class="nav">` wird von `buildNav()` gefüllt (Zeile 7055): Suchfeld (`navSearchHTML()`), `.nav-label` „Falldaten" mit Dashboard/Stammdaten/KI-Fallbesprechung, dann **`.nav-label` „Dokumente"** + `.nav-groups-root` mit `navGroupsHTML()`.
- `navGroupsHTML()` (Zeile 6391–6402): je Gruppe aus `REPORT_GROUPS` ein `.nav-group` mit einklappbarem `.nav-group-toggle` (Chevron ▼, Uppercase-10px-Titel) und `.nav-group-items`; je Dokument aus `REPORTS` eine `.nav-doc-row` (Grid `minmax(0,1fr) 22px`): Haupt-Button `data-report="id"` mit Icon + Titel + `.status-dot` (Prozent), daneben runder Info-Button `.nav-doc-info` (`ⓘ`, Georgia serif, öffnet `showDocumentInfo`).
- Sidebar-Optik ist **dunkel**: Buttons `color:#dfeef7`, Hover `#ffffff13`, aktiv `#2b6288`; `.nav-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#91b4ca}` (Zeile 200–206).
- Hauptbereich: `.topbar` (weiß, sticky, zentrierte Aktionsknöpfe `border:1px solid #bfd0dc;color:var(--blue);min-height:54px`, „Export" als `.primary`), darunter `.content{max-width:1140px}` mit `.paper` (Formularblatt, `border-radius:10px`, Schatten) — Zeile 208–212.

## (4) Modal-System

- Ein einziges generisches Modal (Zeile 4709): `<div id="modal" class="modal hidden"><div class="modal-box"><h2 id="modalTitle"></h2><div id="modalBody"></div><div class="modal-actions"><button class="btn secondary" onclick="closeModal()">Schließen</button></div></div></div>`. Öffnen per Muster: Titel setzen, `modalBody.innerHTML` setzen, `modal.classList.remove('hidden')`; `closeModal()` (Zeile 7394).
- **Basisgröße** (Zeile 220): `.modal-box{width:min(850px,96vw);max-height:90vh;overflow:hidden;display:flex;flex-direction:column;background:#fff;border-radius:12px;padding:20px;box-shadow:0 18px 60px #0005}`; Overlay `background:#16283a88;padding:20px`. `h2` in `var(--blue)`.
- Scrollen: `#modal>.modal-box>#modalBody{flex:1 1 auto;min-height:0;overflow:auto}` (Zeile 224).
- **Große Modals per `:has()`-Aufweitung** — etabliertes Muster, je Feature eine Regel:
  - Admin-Panel: `#modal:has(.admin-shell) .modal-box{width:min(1240px,97vw);max-height:94vh}` (Zeile 37390) — **bestes Vorbild für den Formulareditor**
  - KI-Werkbank: `min(1180px,96vw)`, feste Höhe `min(820px,92vh)`, Body als Flex-Spalte mit `overflow:hidden` (Zeile 477/648)
  - Wohnen: `min(1760px,calc(100vw - 32px))`, Höhe `min(1010px,…)`, `padding:0` (Zeile 2073)
  - Posteingang: `min(1560px,97vw)`, Höhe `min(950px,95vh)` (Zeile 48661); weitere zwischen 900 und 1600px (Zeilen 12025, 43948, 44808, 62460 u. a.)
- Empfehlung fürs Mockup: Formulareditor als `#modal:has(.forms-shell) .modal-box{width:min(1240px,97vw);max-height:94vh}` im Admin-Shell-Layout (Nav links 200px, Inhalt rechts).


## Codestellen
- Zeile 8–12: :root-CSS-Variablen (--blue:#1f4e78, --bg:#eef2f5, --line:#c9d3dc, --ok/--warn/--bad, --ai u. a.)
- Zeile 15: body-Grundstil: Arial/Helvetica, 14px, var(--bg)/var(--ink)
- Zeile 36–37: .btn / .btn.secondary / .btn.light / .btn.danger Grundregeln
- Zeile 200–214: Sidebar-/Nav-CSS: .nav, .nav-label, .nav-group, .nav-doc-row, .nav-doc-info, .doc-info-grid, .doc-info-note, .main-label, .source-badge (Erstfassung), .topbar, .content, .paper
- Zeile 220–228: Modal-Basis: .modal, .modal-box (min(850px,96vw), max-height:90vh), #modalBody-Scrollregel
- Zeile 304–312: .source-badge robuste !important-Fassung (Version 0.4)
- Zeile 1233–1262: .export-options-card, .export-mode-grid, .export-mode-check (Exportzentrale v0.60)
- Zeile 4620–4690: Statisches Sidebar-Markup: .sidebar, #nav, .sidebar-bottom mit details.ai-direct-menu-Gruppen (Fallakte, Fallorganisation, Einstellungen, Büroorganisation)
- Zeile 4692–4705: Topbar des Dokumentenbereichs + .content/#reportContainer
- Zeile 4709: Generisches #modal mit #modalTitle/#modalBody/.modal-actions
- Zeile 6391–6402: navGroupsHTML(): Dokumentliste als .nav-group/.nav-doc-row mit data-report-Button, .status-dot und ⓘ-Info-Button
- Zeile 7055: buildNav(): Nav-Aufbau mit Suchfeld, .nav-label Falldaten/Dokumente, .nav-groups-root
- Zeile 26510–26545: Matcher-Liste für die Einsortierung der Sidebar-Menüeinträge in data-group-body verbindungen/buero
- Zeile 36564–37251: Block export-name-templates-v1: TOK_HELP, tokChip(), __exportNameDetailsHTML(scope), __fnTplPreview/Save/Reset, Betreff-Vorlagen
- Zeile 37192–37203: betreffWerkzeugHTML(): Chip-Leiste mit F/K/U-Formatknöpfen und klickbaren Baustein-Buttons (BETREFF_TOKEN_LISTE)
- Zeile 37204–37250: betreffEditorEinbauen(id) + Wrapper um showDocumentInfo
- Zeile 37390–37430: Admin-Shell-CSS: #modal:has(.admin-shell) .modal-box (1240px/94vh), .admin-nav, .admin-content-head, .adm-seg
- Zeile 37508–37610: admin-panel-script-v1: openAdminPanel(), ADMIN_ICON, ADMIN_NAV_GROUPS (Verwaltung/Einstellungen), adminShellHTML()
- Zeile 59453: Vorbild-Sidebar-Button „Online-Formulare" (data-online-forms-menu, service-accounts-btn)
- Zeile 72762–72790: __fileNameStyleAdminCardHTML(): Admin-Karte „Dateinamen bei Exporten" mit Radio-Grid + Details-Liste
- Zeile 477, 2073, 48661 u. a.: Große Modals per #modal:has(...)-Aufweitung (KI-Werkbank 1180px, Wohnen 1760px, Posteingang 1560px)