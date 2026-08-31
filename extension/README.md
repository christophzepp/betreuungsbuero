# Betreuungsbüro Formular-Assistent (Browser-Erweiterung)

Füllt Behörden-Webformulare (Arbeitsamt, Jobcenter, Rentenversicherung, GEZ …) mit Falldaten aus
dem Betreuungsbüro-Dokumentenassistenten. Chrome/Edge + Firefox, Manifest V3, komplett ohne
Build-Kette (klassische Scripts, kein Bundler).

**Grundsätze:** Nichts wird ohne die Prüfliste ausgefüllt. Nichts wird jemals automatisch
abgesendet – verbindlich wirkende Klicks (absenden/beantragen/kostenpflichtig …) verlangen
IMMER eine ausdrückliche Einzelbestätigung, auch im KI-Agent-Modus.

## Funktionen

- **Fallauswahl**: Fälle vom Server (API-Token) oder lokal importierte Datensicherung.json.
- **Vollständige Datenauswahl**: alle nichtleeren fachlichen Fallfelder werden schemaoffen
  angeboten – einschließlich Berichts-/Formularfeldern, Betreuungsverlauf, Falldokumentation,
  Kontakten (deutsche und englische Feldnamen), Büro-Bankkonten und Mitarbeitenden-Zusatzfeldern.
  Neue Fallfelder erscheinen dadurch ohne Anpassung einer festen Feldliste.
- **Formular scannen + Prüfliste**: Heuristik ordnet Felder den Falldaten zu (deutsches
  Synonym-Lexikon, autocomplete-Attribute, Sektionskontext). Unterscheidet betreute Person vs.
  Betreuer/Büro (die zentrale Verwechslungsquelle deutscher Behördenformulare). Ausfüllen nur
  nach Sichtprüfung, ausgefüllte Felder werden auf der Seite grün markiert.
- **Training/Aufzeichnung**: Felder UND Buttons (Weiter, Zurück, Upload, Hochladen, Bearbeiten,
  Hinzufügen …) einmal anklicken und zuordnen → Site-Profil. Profile werden auf dem Server
  büroweit geteilt (wachsende Formular-Bibliothek) oder lokal gespeichert; beim nächsten Besuch
  „Profil anwenden" + Aktions-Buttonleiste.
- **KI-Vorschläge** (Server-Proxy, Keys bleiben auf dem Server): Feldzuordnung für unbekannte
  Formulare – es werden NUR Feldbeschriftungen + Datenfeld-NAMEN übertragen, nie Werte.
  KI-Texthilfe für Freitextfelder (Falldaten nur nach per-Anfrage-Einwilligung).
- **KI-Agent** für mehrseitige Formulare: Schritt-für-Schritt mit sichtbarem Protokoll,
  Schrittbudget, Origin-Wechsel-Stopp und harter Submit-Sperre.
- **Dokumentation**: jedes Ausfüllen erzeugt ein Ausfüllprotokoll (lokale Historie).
  „Protokoll-PDF" (eigener PDF-Generator), „Seite drucken (PDF)" (visuelle Kopie über den
  Browser-Druckdialog) und „In Falldokumentation übernehmen" (Betreuungsverlauf-Eintrag +
  Protokoll-PDF im Dokumenten-Zwischenspeicher des Falls).
- **Dokument-Upload**: alle aktiven und für den angemeldeten Nutzer sichtbaren Dateien der
  zentralen Fallakte können in Datei-Feldern einer Webseite ausgewählt werden; noch nicht
  zentralisierte Altdokumente bleiben als Fallback verfügbar.
- **Backup**: Optionen → „Backup exportieren/importieren" sichert Einstellungen (ohne Token),
  lokale Fälle, Profile und die Protokoll-Historie als JSON.

## Bauen

```bash
cd extension
node build.js          # erzeugt dist/chrome/ + dist/firefox/
node build.js --zip    # zusätzlich dist/chrome.zip + dist/firefox.zip
```

## Installation

### Chrome / Edge — es gibt KEIN „Signieren" für die normale Installation

Chrome/Edge akzeptieren außerhalb des Web Store nur zwei Wege. Eine selbst signierte `.crx`
weist Chrome grundsätzlich ab („kann nur aus dem Chrome Web Store hinzugefügt werden") — es gibt
also kein lokales Signieren, das eine Doppelklick-Installation ermöglicht.

- **Büro-intern (empfohlen, ohne Konto, ohne Signatur):**
  1. `chrome://extensions` (Edge: `edge://extensions`) öffnen, „Entwicklermodus" aktivieren.
  2. „Entpackte Erweiterung laden" → Ordner `extension/dist/chrome` wählen.
  3. Klick aufs Erweiterungs-Icon öffnet das Side Panel.
  Nachteil: Chrome zeigt bei jedem Start einmal „Entwicklermodus-Erweiterungen deaktivieren?"
  (nur wegklicken). Update = Ordner überschreiben + auf der Seite „Aktualisieren".
- **Ohne diese Meldung / zentral ausgerollt:** per Unternehmensrichtlinie erzwungen installieren
  (`ExtensionInstallForcelist` / Registry bzw. Google-Admin-Konsole) mit einer selbst gehosteten
  `.crx` + fester Extension-ID. Braucht kein Web-Store-Konto, aber Admin-Rechte auf den Geräten.
- **Öffentlich / komfortabelste Installation:** Chrome Web Store (einmalig 5 $ Entwicklerkonto,
  Google signiert automatisch).

### Firefox — Signieren über Mozilla (AMO), dann normal installierbar

Firefox (Release/ESR) installiert dauerhaft nur **von Mozilla signierte** Add-ons. Das Signieren
selbst ist kostenlos und läuft über addons.mozilla.org; die `gecko.id`
(`formular-assistent@betreuungsbuero.local`) ist im Manifest bereits gesetzt.

- **Zum Testen (ohne Signatur):** `about:debugging#/runtime/this-firefox` → „Temporäres Add-on
  laden" → `extension/dist/firefox/manifest.json`. Gilt bis zum Firefox-Neustart.
- **Dauerhaft (signiert):**
  1. Kostenloses AMO-Konto anlegen: <https://addons.mozilla.org/developers/>
  2. API-Zugangsdaten erzeugen: <https://addons.mozilla.org/developers/addon/api/key/>
     → liefert **JWT issuer** (`user:…`) und **JWT secret**.
  3. Im Ordner `extension/` einmalig `npm install`, dann:
     ```bash
     WEB_EXT_API_KEY="user:1234:567" WEB_EXT_API_SECRET="dein-secret" npm run sign:firefox
     ```
     (Der Secret bleibt so in der Shell/Umgebung — nicht in die package.json/README schreiben.)
  4. Ergebnis: signierte `.xpi` unter `extension/dist/…-<Version>.xpi`. Diese Datei per
     Drag-and-drop in Firefox ziehen (oder `about:addons` → Zahnrad → „Add-on aus Datei
     installieren") → installiert dauerhaft, ohne Warnung.
  - Vorab prüfen (ohne Konto, findet Fehler bevor ein Signier-Versuch verbraucht wird):
    `npm run lint:firefox` — muss **0 errors** zeigen (Warnungen sind unkritisch).
  - „unlisted" = Selbstverteilung, kein öffentlicher AMO-Eintrag, keine menschliche Prüfung;
    bei 0 errors signiert AMO automatisch in Sekunden.

**Safari:** bewusst zurückgestellt (benötigt Xcode-App-Wrapper + Apple-Developer-Konto).

## Einrichtung

1. In der Anwendung (Online-Modus): **Nutzer-Menü → Erweiterungs-Zugänge → Neues Token anlegen**
   und den einmalig angezeigten Klartext kopieren.
2. Erweiterungs-**Optionen**: Server-URL (z. B. `http://localhost:8935` bzw. die spätere
   Domain) + Token eintragen → „Speichern & verbinden", dann „Server-Zugriff erlauben".
3. Im Side Panel Fall wählen → auf der Behördenseite „Formular scannen".
   Beim ersten Scan je Webseite fragt der Browser einmalig nach der Zugriffserlaubnis.

Ohne Server (Lokal-Modus der Anwendung): in den Optionen unter „Lokale Fälle" eine
Datensicherung.json importieren.

## Grenzen / Hinweise

- Cross-Origin-iframes (fremde Domain innerhalb der Seite) sind technisch nicht zugänglich –
  der Scan meldet sie als Hinweis.
- Der Handshake mit dem Server erzwingt Versions-Kompatibilität: veraltete Erweiterungen zeigen
  ein Update-Banner und deaktivieren Schreibfunktionen.
- KI-Funktionen erscheinen nur, wenn auf dem Server ein KI-Anbieter konfiguriert ist
  (Admin-Panel → KI-Zugangsdaten).
- API-Tokens lassen sich in der Anwendung jederzeit widerrufen (Nutzer-Menü bzw. Admin-Sicht).

## Struktur

```
extension/
  manifest.chrome.json / manifest.firefox.json
  build.js                    # Kopier-„Build", kein Bundler
  src/
    background.js / background-chrome.js
    common/   browser-shim, api (Server-Fassade), synonyms (dt. Lexikon),
              dictionary (Fill-Dictionary, Port von flattenStammdatenToRows),
              matcher (Heuristik), pdf (eigener Protokoll-PDF-Generator)
    content/  scanner (Deskriptoren, Shadow-DOM + same-origin-iframes),
              filler (nativer Setter + Events, framework-sicher),
              overlay (Markierung + Pick-Modus), main (Message-Router)
    panel/    Side Panel (Fallauswahl, Prüfliste, Training, KI, Agent, Protokoll)
    options/  Server/Token, lokale Fälle, Addon-Backup, Protokoll-Historie
  test-fixtures/              # Formular-Fixtures + Integrations-Harness (runPipelineTest)
```
