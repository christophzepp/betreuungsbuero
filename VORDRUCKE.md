# Amtliche Vordrucke — Herkunftsnachweis

Die PDF-Dateien unter `server/tools/pdf-overlay/vorlagen/` sind **Vordrucke Dritter**. Sie
stehen **nicht** unter der Lizenz dieses Projekts (siehe [`NOTICE.md`](NOTICE.md)).

## Wie sie verwendet werden

Die Anwendung **überlagert** die Originaldatei: Werte werden koordinatengenau auf das
unveränderte Formular geschrieben, so wie es beim Ausfüllen von Hand geschieht. Die Vordrucke
werden **nicht nachgebaut, nicht umgestaltet und nicht inhaltlich verändert**. Zu jedem
Vordruck gehört eine Koordinatenkarte, die vor der Freigabe gegen einen Goldstandard geprüft
wird.

Rechtlicher Hintergrund: § 5 Abs. 2 UrhG stellt amtliche Werke frei, die im amtlichen Interesse
zur allgemeinen Kenntnisnahme veröffentlicht wurden — mit **Änderungsverbot** (§ 62 UrhG) und
**Quellenangabepflicht** (§ 63 UrhG). Ob und für welche dieser Vordrucke das gilt, ist nicht
abschließend geklärt; die kommunalen Formulare unten sind der unsicherere Teil. Dieses
Verzeichnis erfüllt die Quellenangabe und macht nachvollziehbar, welcher Stand verwendet wird.

> **Zu ergänzen:** Quell-URL und Abrufdatum kennt nur, wer die Dateien beschafft hat. Bitte je
> Zeile eintragen — beides ist für die Quellenangabe nötig und zeigt später, ob ein Vordruck
> veraltet ist.

## Bundesweite Vordrucke

| Datei | Formular | Herausgeber | Quelle | Abgerufen |
| --- | --- | --- | --- | --- |
| `tpl_kg1.pdf` | Antrag auf Kindergeld (KG 1) | Familienkasse der Bundesagentur für Arbeit *(aus PDF-Metadaten)* | — | — |
| `tpl_kgan.pdf` | Anlage Kind zum Antrag auf Kindergeld (KG 1-AnK) | Familienkasse der Bundesagentur für Arbeit *(aus PDF-Metadaten)* | — | — |
| `tpl_kg11e.pdf` | Abzweigungsantrag (KG 11e) | Familienkasse der Bundesagentur für Arbeit | — | — |
| `tpl_wba.pdf` | Weiterbewilligungsantrag Bürgergeld | Bundesagentur für Arbeit / Jobcenter | — | — |
| `tpl_v159_alg1_initial_application.pdf` | Erstantrag Arbeitslosengeld | Bundesagentur für Arbeit | — | — |
| `tpl_v159_alg1_health_questionnaire.pdf` | Gesundheitsfragebogen | Bundesagentur für Arbeit | — | — |
| `tpl_v159_broadcast_exemption_application.pdf` | Antrag auf Befreiung vom Rundfunkbeitrag | ARD ZDF Deutschlandradio Beitragsservice | — | — |
| `tpl_v159_sgb9_initial_application.pdf` | Erstantrag Leistungen zur Teilhabe (SGB IX) | Rehabilitationsträger | — | — |

## Kommunale und regionale Vordrucke

Diese stammen von einzelnen Sozialämtern, Jobcentern oder Vermietern. Bei ihnen ist am
wenigsten gesichert, dass § 5 Abs. 2 UrhG greift — hier ist die Herkunftsangabe am wichtigsten.

| Datei | Formular | Herausgeber | Quelle | Abgerufen |
| --- | --- | --- | --- | --- |
| `tpl_v159_sgb12_social_assistance_application.pdf` | Sozialhilfefragebogen (SGB XII) | Sozialamt *(zu benennen)* | — | — |
| `tpl_v159_sgb12_social_assistance_short.pdf` | Antrag Sozialhilfe, Kurzfassung | Sozialamt *(zu benennen)* | — | — |
| `tpl_v159_sgb12_asset_declaration.pdf` | Vermögenserklärung (SGB XII) | Sozialamt *(zu benennen)* | — | — |
| `tpl_v159_rent_certificate.pdf` | Mietbescheinigung | Kommune *(zu benennen)* | — | — |
| `tpl_v159_rent_certificate_jc.pdf` | Mietbescheinigung (Jobcenter-Fassung) | Jobcenter *(zu benennen)* | — | — |
| `tpl_v159_rent_offer_certificate.pdf` | Bescheinigung über Mietangebot | Kommune *(zu benennen)* | — | — |

## Hinweise für die Pflege

- **Beim Austausch eines Vordrucks** immer die Koordinatenkarte neu prüfen: Ein neuer Jahrgang
  verschiebt Felder, und ein verschobenes Feld schreibt den richtigen Wert an die falsche
  Stelle — das fällt auf dem Bildschirm nicht auf, wohl aber der Behörde.
- **Abrufdatum eintragen.** Behördenformulare werden ohne Ankündigung ersetzt; ohne Datum lässt
  sich nicht sagen, ob eine gespeicherte Fassung noch aktuell ist.
- **Personenbezug in Metadaten.** Einige Dateien tragen in den PDF-Metadaten interne
  Bearbeiterkürzel der ausgebenden Stelle (z. B. `k502401`, `Jakobi`). Das ist unkritisch, aber
  vor einer Veröffentlichung des Repositories einen Blick wert.
- **Nachbauen statt überlagern** würde die Rechtslage deutlich verändern: Dann greifen
  Änderungsverbot und die Kennzeichenrechte der Behörden (Bundesadler, Wortmarken). Beim
  Overlay-Verfahren bleiben beide unberührt.
