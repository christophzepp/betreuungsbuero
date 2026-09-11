# Linke Filterleiste im Fristen-Menü

Stand: 11. September 2026.

Die Leiste nutzt abhängig von der Fensterbreite 220–248 statt 204 Pixel. Herkunftsfilter haben getrennte Spalten für Symbol, umbrechende Beschriftung und Anzahl. Zähler sind gleichmäßig ausgerichtet; Nullwerte bleiben anwählbar. Kompaktere Felder und Abschnittsabstände lassen mehr Filter gleichzeitig sichtbar. Die Leiste scrollt weiterhin unabhängig; oben steht zusätzlich „Alle Filter zurücksetzen“ bereit.

Geprüft wurde die ausgelieferte Anwendung mit synthetischen Falldaten und abgefangenen Netzwerkanfragen. Je 15 Prüfungen in Chromium und WebKit erfolgreich: Darstellung bei 1440 × 1000, 1440 × 800, 1024 × 768 und 768 × 700; Erreichbarkeit der unteren Filter; Herkunft, Nulltreffer, Zurücksetzen, kombinierte Fall-/Kategorie-/Prioritätsfilter und mobile Filteransicht. Keine JavaScript-Laufzeitfehler. Die zehn vorhandenen Prüfungen in `html-fristen-workspace.test.cjs` bestehen ebenfalls.

[Desktop in WebKit](desktop-webkit.png) · [Dunkle Darstellung](dunkel-webkit.png)
