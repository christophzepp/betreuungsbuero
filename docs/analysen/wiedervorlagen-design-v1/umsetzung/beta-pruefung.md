# Beta-Prüfung vom 11. September 2026

Freigabe durch Nutzer: „okay. pushe den neuen stand in die beta.“

Enthalten sind das zentrale Wiedervorlagenmenü einschließlich mobiler Ansicht, Dark Mode und GUI-Korrekturen, die E-Mail-Wiedervorlagen-Anbindung, das Wording „Erinnerung vor Fristablauf“ sowie die optimierte Fristen-Seitenleiste.

Unmittelbar vor dem Push: **1.395 Tests bestanden, 0 fehlgeschlagen, 0 übersprungen** (`npm test` im Serververzeichnis; Laufzeit rund 40 Sekunden). Vollständiges Ergebnis: `beta-gesamtsuite.txt`.

Die vorherige GUI-Abnahme umfasst zusätzlich 190 Browserprüfungen in Chromium und WebKit. Ergebnisse und Bildschirmbilder: `gui-korrektur/`.

Ziel ist ausschließlich `origin/develop`. Der dortige Workflow veröffentlicht `ghcr.io/christophzepp/betreuungsbuero-beta:beta` für AMD64 und ARM64 nach einem Container-Starttest.
