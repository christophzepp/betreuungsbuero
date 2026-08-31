# Kuratierungsplan Dokumentenerstellung (12.08.2026)

Ausgenommen (Gold-Standards, Handarbeit des Nutzers): free_document, care_application_person,
care_application_zepp, care_change_person, housing_inspection_inventory, court_payment_notice.

## Teil A — V159-JSON-Patches (Zeile 27352, per Node-Skript, dauerhaft in der Quelle)

A1 Teilwert-Fehlmappings in pdfFields (nur wenn Label-Muster UND bekanntes Fehlmapping zusammen):
   - Label ~ /straße.*haus|haus.*straße/i  & sourcePath person.houseNumber  -> person.street (Komposit)
   - Label ~ /plz.*(stadt|ort)/i           & person.postalCode              -> person.postalCity
   - Label ~ /vorname\s*,?\s*(name|nachname)|^name,\s*vorname$/i & person.firstName -> person.fullName
   - Label ~ /amts-?\s*\/?\s*(oder\s*)?familiengericht/i & person.address  -> care.courtAddress
A2 Berichtszeitraum-pdf-Felder: Label ~ /berichtszeitraum.*(beginn|start|anfang)/i -> deriveKey periodFrom;
   /(ende|schluss)/ -> periodTo (deriveKeys werden in Teil B implementiert).
A3 flatSchemas-Standardblock: *_reference bleibt UNGEMAPPT (Az. des Leistungsträgers != Gerichts-Az.),
   bekommt hint. alg1_health_questionnaire: unsinnige deriveKeys (household/benefit/assetSummary) entfernen,
   Labels fachlich (Gesundheitsfragebogen: Beschwerden/Behandlungen/Einschränkungen statt Haushalt/Einkommen).
   rent_offer_certificate: falsche Vorbefüllung aus aktueller Miete + person.address für ANGEBOTS-Objekt entfernen.
A4 Katalog-Metadaten (80 Einträge): Tippfehler (Kondergeld->Kindergeld, Befreiuungs->Befreiungs);
   author/authority regelbasiert je Gruppe (cat_02/04: Betreuungsbüro/Betreuungsgericht; cat_03 dito;
   SGB2: Bundesagentur für Arbeit/Jobcenter; SGB12: zuständiger Sozialhilfeträger; SGB9: Eingliederungshilfeträger;
   Rente: Deutsche Rentenversicherung; cat_06 Wohngeld: Wohngeldbehörde; Rundfunk: Beitragsservice;
   cat_08 Kindergeld: Familienkasse; cat_10/Briefe: Betreuungsbüro/Empfänger laut Anschreiben;
   GKV: Krankenkasse; Banken: kontoführende Bank; cat_05 Vorsorge: Betreuungsbüro bzw. Bundesministerium der Justiz
   bei amtlichen Broschüren-Vorlagen — nur wo sicher). accounting-Eintrag an Modul angleichen
   (title Rechnungslegung, template 'Automatisierte Rechnungslegung mit Bank- und Belegimport',
   templateDate V1.57.9, pages 'dynamisch je Konto').
A5 letterTemplates: letter_care_end Satzbau ('durch mit beendet'), letter_benefit_notice 'gegebenfalls',
   letter_death_notice 'XX.XX.XXXX'-Platzhalter raus (Datum kommt aus Pflichtfeld letter_death_date).

## Teil B — Laufzeit-Kuratierungsblock (JS, ans Ende des bestehenden v232-Script-Blocks, blockneutral)
Abschnitt 'Version 2.36 - Dokumenten-Kuratierung' mit Migrations-Flags __documentCurationV236*.

B1 v159Derived-Wrapper: neue Keys periodFrom/periodTo (aus state.reports[id].meta).
B2 Master-Refresh-Generalisierung im seedReport-Wrapper: Felder mit sourcePath/MASTER_FIELD_PATHS
   (nur primitive Werte) werden bei Stammdatenänderung aktualisiert, wenn source==='master' && !cleared.
B3 Doppelstrukturen auflösen (Muster v226/v232) — pdf_-Sektionen filtern + Migration + Export-Bridge:
   - self_management: Bridge sm_* -> pdf (Name/Adresse/Zeitraum/Bank/IBAN...); Migration pdf_0007/0008->sm_period_*
   - discharge: Bridge dis_* -> pdf; Migration Zeitraumfelder
   - care_change_zepp: Kuratierung nach v232-Muster (Metadaten '--'/Betreuungsbüro/Betreuungsgericht,
     ccz_place_date deriveKey placeToday statt defaultValue 'St. Goarshausen', Bridge ccz_->pdf inkl.
     pdf_0001=care.courtAddress-Fix), Einreihung hinter care_change_person
   - power_of_attorney: pdf-Ebene (69 kontextlose Felder) filtern; Original-Export deaktivieren
     (OFFICIAL ready=false + getExportOptions-Wrapper original=false); Kern-34 bleiben.
B4 Gerichts-Berichte:
   - initial: current_residence sourcePath -> person.institution (Fix Meldeanschrift-Duplikat)
   - annual_assets/noassets: home_placement sourcePath care.homePlacement
   - court_approval: required für ca_art/ca_vorgang/ca_beschluss? (beschluss erst nach Genehmigung — nein);
     required: ca_art, ca_vorgang, ca_begruendung; neues Feld ca_rechtsgrundlage (select, §§ 1829/1831/1832/1833/1848 ff. BGB)
   - closing + PERSPECTIVE: bedingte Pflichten in validateReport-Erweiterung
     (documents_status 'übergeben' -> documents_date/documents_recipient; discussed 'ja' -> discussed_date)
   - remuneration: rem_stage options +'3' (VBVG Tabelle C), rem_sections required
B5 advance_directive: Kopfsektion 'Verfügende Person' (ad_person_name/birth/address, sourcePaths) voranstellen.
B6 rent_certificate/jc: sourcePaths sichtbar ins Schema (accommodation.*), rent_extra->serviceCosts.
   (MASTER_FIELD_PATHS wirkt schon — Schema-sourcePath macht es im Panel sichtbar und konsistent.)

## Teil C — Kern-SCHEMAS-Edits (Z. 3864-4414, direkte Edits)
Siehe B4/B5/B6 — Schema-Texte liegen dort; Laufzeitblock nur für Migrationen/Bridges/Validierung.

## Teil D — Prüfstand
Neue Testdatei tests/html-document-curation.test.cjs: Fehlmapping-Muster nicht mehr vorhanden;
Metadaten-Stichproben (SGB2->Jobcenter, accounting-Titel); Brieftexte repariert; Skip/Filter der
pdf-Ebenen (self_management/discharge/power_of_attorney/care_change_zepp); ca_rechtsgrundlage existiert;
V236-Flags vorhanden. Vorher/Nachher npm test (Basis 381/380/1).

## Runde 2 — Dokumenteninformationen (22.08.2026)

Nutzerauftrag: alle Dokumenteninformationen (i-Dialog) mit recherchierten Angaben füllen;
Goldstandards (Handarbeit des Nutzers, NICHT anfassen): free_document, care_application_person,
care_application_zepp, care_change_person, care_change_zepp, letter_care_notice, initial.
Deren Werte kommen aus den bestehenden Laufzeitblöcken (~Zeilen 117350–119880).

Werkzeug: `dokumentinfo-patch.js` + `kuration-dokumentinfo.json` — patcht die V159-Katalogzeile
dauerhaft in der Quelle (72 Einträge, 271 Feldwerte) und hinterlegt `DOC_EXPORT_DEFAULTS_V260`
vor `getExportOptions` (Standardempfänger/Standardausgabe je Dokument; gespeicherte Werte und
die V159-/v252-Wrapper mit `original`+`contact` für eingebettete PDF-Originale gehen weiter vor).

Muster je Dokumentart: interne docx-Briefe und Büro-PDFs `--`/`--`/Betreuungsbüro; amtliche
Vordrucke mit Klartext-Zusatz im Dateinamen, recherchiertem Urheber, Stand (leer = „nicht
ausgewiesen") und Originalquelle-Link. Recherchierte Kernquellen: BA-Bürgergeld (HA/WBA 04/2026,
alle Anlagen mit offiziellen Langnamen), Familienkasse (KG 1 09/2025, KG 11e 07/2022), DRV
(R0100 02/2025, R0210), MV-Justiz F 4449 (04/2023) und F 292, AG Mainz Jahresberichte
(01.03.2023), LSJV RLP (Schwerbehinderung), fm.rlp (Mietzuschuss MZ), MFFKI RLP (UVG 01/2023),
MWG RLP (Totenfürsorge 17.03.2026), BMJ (Vorsorge 2023), Bundesnotarkammer ZVR, Beitragsservice.


## Vorlagenrunde 23.08.2026

Der Nutzer hat sieben Vordrucke bereitgestellt (Ordner `vorlagen-2026-08`). Werkzeug:
`vorlagen-tausch.js` + `vorlagen-tausch.json` (wiederholbar; tauscht Base64-Nutzlasten, legt
Katalog-, Vorlagen- und Schemaeinträge an, ergänzt Seitenleisten-Kürzel).

Getauscht, weil die eingebettete Fassung nicht taugte:

| Dokument | vorher | jetzt |
|---|---|---|
| accounting | ausgefüllte 19-Seiten-Abrechnung einer fremden Person | Blankovordruck 2 S. (F_3705_G8727) |
| closing | Scan 578×824 mit getilgter Gerichtsanschrift | Text-PDF A4 (F_583_I1763) |
| annual_assets | wortgleich, Briefkopf AG Mainz | Briefkopf AG Bad Dürkheim (F_294_I1755) |
| annual_noassets | dito | dito (F_296_I1756) |

Neu aufgenommen: `care_extension` (Erweiterung des Aufgabenkreises, cat_01, Kürzel EAK) und
`death_notice_court` (Todesmitteilung an das Gericht, cat_04, Kürzel TM). Beide sind Vordrucke
von Jörg Staatsmann (© 2007, Richter am AG Montabaur) — urheberrechtlich geschützt, Lizenz­vorbehalt.

NICHT getauscht: `asset_inventory`. Die neue Fassung (F_285_I3787) zitiert weiterhin § 1836c BGB
a. F.; die eingebettete BS-10-Fassung von 02.2012 ebenso. Aktuell wäre BS 10 „gen. 01.2023" mit
§ 1835 BGB (MV/NRW). Entscheidung steht beim Nutzer.

### Koordinatenkarten

`koordinaten-karten.js` + `koordinaten-karten.json` tragen Positionen in
`OFFICIAL_COORDINATE_MAPS` ein. Sobald ein Dokument dort steht, hebt `flat-original-overlay-v253`
die Sperre auf (`mode:'flat'`, `ready:true`) und schreibt direkt auf die Originalseiten — ein
generisches Ausfüllblatt ist ausdrücklich verboten.

Messwerkzeuge: `pdf-messblatt.js` (Text-PDFs: Ausfülllinien, Kästchen, Beschriftungen in
PDF-Punkten), `scan-vermessen.py` + `pdf-seitenbilder.js` (gescannte Vordrucke ohne Textebene),
`koordinaten-probe.js` (schreibt Musterwerte an alle Positionen, Ergebnis visuell prüfen).

Fertig und am Probedruck geprueft: `closing` (30), `annual_noassets` (52), `care_extension` (36),
`death_notice_court` (11). Offen: `annual_assets` (eigene Gliederung A/B/C mit Tabellen),
`asset_inventory` (Tausch auf BS 10 01/2023 steht noch aus), `remuneration_pdf`,
`funeral_directive`, `advance_directive`, `care_suggestion`.
`accounting` bleibt auf Nutzerentscheid gesperrt: das Modul druckt weiter sein eigenes Layout,
der Blankovordruck liegt nur als Referenz bei.

### Kopffelder aus den Stammdaten

Vordrucke haben Absender-, Gerichts- und Ort/Datum-Zeilen, fuer die es kein Dokumentenfeld gibt.
Karten koennen diese ueber Schluessel mit dem Vorsatz `stamm.` setzen; der Aufloeser
`window.__stammwertV262` steht im Block `flat-original-overlay-v253`. Verfuegbar sind
betreuerName, betreuerAnschrift, betreuerTelefon, gerichtName, gerichtOrt, gerichtStrasse,
gerichtPlzOrt, aktenzeichen, personName, personGeburtsdatum, personAnschrift, ortDatum, datum.
Wo der Briefkopf eingedruckt ist (Bad Duerkheim), duerfen die gericht*-Schluessel NICHT gesetzt werden.

### Nichts wird stillschweigend geschluckt

Drei Schutzvorkehrungen im koordinatenbasierten Export:
* ein befuelltes Schemafeld ohne Position bricht den Export ab (bestand bereits),
* ein gewaehlter Auswahlwert ohne Kreuzposition ebenfalls - `null` in der Karte heisst
  ausdruecklich "hier bleibt das Kaestchen leer" und ist erlaubt,
* Text, der nicht in die vorgesehenen Zeilen passt, wird gemeldet statt gekuerzt.

### Vorlagenrunde 2 (24.08.2026, nach Ruecksprache)

| Dokument | Aktion |
|---|---|
| annual_assets / annual_noassets | auf die landeseinheitliche RLP-Fassung Stand 04.12.2024 getauscht (leerer Briefkopf) |
| care_suggestion | neu: Betreuungsanregung Stand 05.12.2024, zitiert § 1814 BGB |
| letter_death_notice | umbenannt in "Todesmitteilung an Dritte" |
| care_extension | Aktenzeichen wird rechts neben den Namen gedruckt |

Die RLP-Fassung 12/2024 ist **nicht** wortgleich mit der Bad-Duerkheimer: sie fragt zusaetzlich nach
Hausarzt, weiterem Arzt, Orientierung, Verstaendigungsfaehigkeit und Gruenden der Zustandsaenderung
und hat eine eigene Seite zur Aufwandspauschale. Fuer diese Zusatzfragen fehlen im Dokument noch
Felder; die Zeilen bleiben vorerst leer.

### Werkzeugfehler, die dabei gefunden wurden

* `pdf-textlage.js` hat die Transformationsmatrix (`cm`) ignoriert - Seiten mit Versatz lieferten
  negative y-Werte. Jetzt wird die Textmatrix mit der laufenden Matrix verrechnet.
* Die Versatzerkennung liess sich von Kleinbuchstabenketten taeuschen; jetzt entscheiden ganze
  deutsche Woerter, Buchstabenketten sind nur der Stichentscheid.
* Kaestchen- und Linienpositionen wurden aus zusammengefassten Woertern geschaetzt und lagen bis zu
  50 Punkte daneben; sie werden jetzt aus den einzelnen Textstuecken gelesen.

## Vorlagenrunde 3 (24.08.2026)

**Anfangsbericht auf Brandenburg getauscht** (Nutzerentscheid): F 4389, Stand 02/2026, dieselbe
Formularreihe, ohne festen Briefkopf, mit sechs Fragen mehr als die Mainzer Fassung. Dabei wurden
drei Altpfade entschärft, die sonst die neue Vorlage mit alten Positionen beschrieben hätten:

* Die handgesetzte Direktzuordnung `createInitialOriginalPdfV253` greift nur noch, solange keine
  Koordinatenkarte vorliegt UND die eingebettete Vorlage vier Seiten hat.
* `applyInitialReportMetadataV252` trug die Mainzer Angaben immer wieder nach; der Block führt jetzt
  die Brandenburger Werte und setzt `ready` nicht mehr pauschal.
* Der eigene Vermögensverzeichnis-Pfad `v159CreateAssetInventoryPdf` tritt hinter eine
  Koordinatenkarte zurück.
* Die Sperrschleife im Block `flat-original-overlay-v253` erfasst jetzt auch den Modus `flat`:
  eine getauschte Vorlage ohne Karte ist gesperrt statt falsch befüllt.

**Vermögensverzeichnis auf BS 10 (gen. 01.2023) getauscht** — Nachfolgefassung derselben Reihe,
nach neuem Recht (§ 1835 BGB im Titel), Text-PDF statt 2-MB-Scan.

**Neue Koordinatenkarten:** `care_suggestion` (50 Positionen), `initial` (67 Positionen).
Zusammen mit der vorigen Runde sind sechs Vordrucke direkt zugeordnet und freigegeben.

### Runde 4 (24.08.2026): die drei offenen Punkte abgearbeitet

**Totenfürsorgeverfügung** — Schema an den Vordruck angeglichen (fünf Bestattungsarten mit je
eigener Detailzeile, drei Personen mit je vier Angaben statt Sammel-Freitexten) und Karte mit 30
Positionen gebaut, beide Seiten am Probedruck geprüft. Die frühere Feldliste war nirgends sonst
referenziert, der Umbau war deshalb gefahrlos. Die Unterschriftszeile bleibt bewusst frei: das
Feld `fd_signature_declarant` ist in der Karte auf `null` gesetzt.

Der Vordruck ist mit einer nicht auflösbaren Kodierung gesetzt. Das Messblatt erkennt in solchen
Fällen jetzt Ausfülllinien daran, dass ein Zeichen oder Zeichenpaar vielfach wiederholt wird; die
Ankreuzkästchen wurden am gerenderten Seitenbild abgegriffen.

**Jahresbericht mit Vermögenssorge** — Karte mit 55 Positionen und zwei Tabellen. Dafür wurde die
Tabellenzuordnung erweitert: Vordrucke mit vorgedruckten Kategorien statt freier Zeilenliste
brauchen keine Reihenfolge, sondern eine Zuordnung über den Wert einer Spalte.

```
"tables": { "assets_detail": { "page":2, "zuordnenNach":"category",
  "columns": { "category":{...}, "institution":{...}, "amount":{...} },
  "zeilen": { "Girokonto":{"y":702},
              "Bargeld":{"y":450,"spalten":{"category":false,"institution":false}},
              "*":{"y":429} } } }
```

`zeilen` ordnet über den Kategoriewert zu, `*` ist die Auffangzeile, `spalten` erlaubt je Zeile
abweichende Spalten (`false` = diese Spalte gibt es in dieser Zeile nicht). Passt eine Angabe in
keine Zeile und ist die Auffangzeile belegt, bricht der Export mit Hinweis ab.

**Patientenverfügung und Vergütungsantrag** — dauerhaft ausgegraut über
`DOK_OHNE_AMTSVORDRUCK`. Ihre eingebetteten PDFs sind kein ausfüllbares Formular: die eine ist die
BMJ-Broschüre „Textbausteine Patientenverfügung" (Fließtext ohne eine einzige Ausfülllinie), die
andere ein Ausdruck des büroeigenen Vergütungsrechners mit eigenem Briefkopf.

### Vermögensverzeichnis: Anker auf BS 10 (01.2023) neu gesetzt

Das Vermögensverzeichnis läuft nicht über `OFFICIAL_COORDINATE_MAPS`, sondern über den eigenen
Erzeuger `v159CreateAssetInventoryPdf`. Der schreibt Kategoriesummen an benannte Anker aus
`V159.assetCoordinates` und hängt die vollständige Postenliste als Detailseiten an. Die alten 144
Anker gehörten zur BS-10-Fassung von 2012.

Werkzeug: `assetkoordinaten-setzen.js` + `assetkoordinaten-bs10.json`, Sichtprobe mit
`assetkoordinaten-probe.js`. Das Setzwerkzeug liest die tatsächlich benutzten Ankernamen aus dem
Erzeuger — auch die, die erst zur Laufzeit aus der Liste `aggregate` kommen — und bricht ab, wenn
einer fehlt. Ohne diese Prüfung würde eine Angabe im Export lautlos verschwinden.

48 Anker, alle sechs Seiten am Probedruck geprüft. Der Ankerrahmen ist die Feldunterkante; der
Erzeuger rechnet daraus Grundlinie (`y + max(2,(height-9)/2)`) und Schriftgröße (`height*0.48`).

Zwei Ergänzungen waren nötig:

* `clear` in `drawCoordinateText` deckt vorgedruckte Musterwerte vorher weiß ab. BS 10 bringt in
  den Summenfeldern ein vorberechnetes „€ 0,00" mit und auf der Unterschriftsseite ein
  Erzeugungsdatum; ohne Abdeckung stünden zwei Angaben übereinander.
* Der Unterschriftsort war als `'St. Goarshausen'` fest verdrahtet und kommt jetzt aus den
  Stammdaten (`stamm.betreuerOrt`).

Nicht befüllt bleiben die Übertragsfelder auf den Seiten 3 und 4 sowie das vorgedruckte Datum auf
der Unterschriftszeile der betreuten Person: der Erzeuger kennt nur zwei Seitensummen, und für die
übrigen Übertragszellen gibt es keinen Anker. Die maßgeblichen Zahlen — „Vermögen gesamt" und
„Schulden gesamt" — werden gesetzt.

### Stand

61 von 69 Vorlagen freigegeben. Die acht übrigen sind es aus fachlichen Gründen: vier
Goldstandard-Dokumente und die Vorsorgevollmacht wurden früher bewusst stillgelegt, die
Rechnungslegung behält auf Nutzerentscheid ihren eigenen Ausdruck, und Patientenverfügung wie
Vergütungsantrag sind dauerhaft ausgegraut, weil ihre eingebettete PDF kein Formular ist.
Damit hat jedes Dokument, das eine Zuordnung haben kann, eine.

## Echter Durchlauf im angemeldeten Prüfstand (24.08.2026)

Erst der Lauf mit echten Falldaten hat zwei Dinge gezeigt, die keine Sichtprobe zeigen konnte.

**Schriftfehler.** `createCoordinatePdf` und der Vermögensverzeichnis-Erzeuger betteten Helvetica
ein — eine WinAnsi-Schrift. Beim Demofall brach der Export mit „WinAnsi cannot encode ş" ab: jeder
Name mit ş, ł, ć, ğ oder ı hätte jeden Originalexport unmöglich gemacht. Beide nutzen jetzt
`unifiedDocumentFonts` (DejaVu mit Fontkit, Helvetica nur als Rückfall). Der Helfer lag in einem
späteren Block und wurde dafür auf `window` veröffentlicht.

**Vordruckzeilen sind kürzer als die Texte des Büros.** Ein „persönlicher Eindruck" hat im Demofall
643 Zeichen; die vier Linien des Vordrucks fassen etwa 260. Betroffen war fast jedes lange Textfeld:
beim Anfangsbericht 18 Angaben, beim Jahresbericht mit Vermögenssorge 12.

Die Vordrucke sehen dafür selbst etwas vor („Für weitere Mitteilungen bitte Beiblatt verwenden!",
„Für eine größere Aufstellung verwenden Sie bitte ein gesondertes Blatt"). Genau das macht der
Export jetzt: `zeichneBeiblatt` hängt A4-Seiten an, auf denen jede Angabe unter ihrer
Feldbezeichnung vollständig steht — mit Vordruckname, Person, Aktenzeichen und Seitenzählung.

Das ist kein Rückfall in das verbotene „Ausfüllblatt". Der Unterschied: der Vordruck wird
vollständig befüllt; das Beiblatt trägt ausschließlich, was daneben keinen Platz hat. Es nimmt drei
Fälle auf — Text, der die Zeilen sprengt; ein Auswahlwert, für den es kein Kästchen gibt; und ein
Feld, das der Vordruck gar nicht kennt (etwa „Handeln gegen den Willen" im Brandenburger
Anfangsbericht). Vorher brach der Export in all diesen Fällen ab und war mit echten Daten unbenutzbar.

**Gleichartige Tabellenposten werden zusammengefasst.** Der Demofall hat fünf Schulden und mehrere
Sonderposten, der Vordruck hat je eine Zeile dafür. Treffen mehrere Posten dieselbe Zeile, werden
Beträge addiert und Beschriftungen verbunden — so, wie man den Vordruck von Hand ausfüllt.
`zuordnenNach` darf dafür mehrere Spalten nennen: erst die Kategorie, sonst die Art.

### Ergebnis

Alle neun zugeordneten Vordrucke erzeugen mit echten Falldaten ihr Original:

| Dokument | Seiten | Felder | Beiblatt |
|---|---|---|---|
| Vermögensverzeichnis | 7 | 11 | – |
| Anfangsbericht | 7 | 47 | 18 Angaben |
| Schlussbericht | 2 | 7 | – |
| Jahresbericht ohne Vermögenssorge | 5 | 13 | – |
| Jahresbericht mit Vermögenssorge | 8 | 41 | 12 Angaben |
| Betreuungsanregung | 4 | 8 | – |
| Erweiterungsantrag | 4 | 6 | – |
| Todesmitteilung | 1 | 6 | – |
| Totenfürsorgeverfügung | 2 | 6 | – |

## Dokumenteneigenschaften überarbeitet (24.08.2026)

Werkzeug: `staende-setzen.js` + `staende-2026-08.json`. Die JSON-Datei führt zu jeder Angabe einen
`beleg`-Text mit, der begründet, woher der Wert stammt — er steht bewusst nicht im Dialog, sondern
dient der nächsten Prüfung.

**Kein Dokument ist mehr ohne Stand.** 20 leere Felder wurden gefüllt: teils mit einem echten Stand,
teils mit einer ausformulierten Auskunft. Ein leeres Feld war zweideutig — es konnte „noch nicht
geprüft" oder „der Vordruck druckt keinen auf" heißen. Beides steht jetzt ausdrücklich da.
Sieben der neun zuletzt geprüften Vordrucke drucken tatsächlich keinen Stand auf.

**Zwei Fehldeutungen korrigiert:**

* Der Rentenantrag trug „eingebundene Fassung 02/2025". Die Fußzeile lautet
  `Version 50035 - ABF-FORTAQ 2/2025` — „2/2025" ist ein Auflagenzähler, kein Monat. Beweis: R0215
  trägt `Version 09009 - AGRTAQ 2/2018 - Stand 05.12.2018`. Richtig ist **Stand 01.07.2026**.
* Als Schweigepflichtentbindung DRV war R0210 ausgewiesen (15 Seiten). Eingebettet ist tatsächlich
  die vierseitige Zweitausfertigung **R210e**; Name und Quelle waren falsch.
* Nebenbefund: die Nummer „26104" der Entlastungserklärung ist keine amtliche Formularnummer.
  Der Vordruck heißt **F 292**.

**Schreibweise vereinheitlicht:** Monatsangaben durchgehend MM/JJJJ (vorher auch „Januar 2023" und
„01.2023"). Ausformulierte Auskünfte bleiben als solche stehen.

**Der Dialog sagt jetzt, wie die Angaben auf die Vorlage kommen** — `dokUebernahmeart` unterscheidet
direkte Koordinatenzuordnung, eigene Formularfelder, den Vermögensverzeichnis-Pfad und eigenes
Layout. Der Umfang nennt das Beiblatt, aber nur wo eines entstehen kann (Modus `flat`). Wo die
Sperre eine Entscheidung ist, steht das statt „noch nicht freigegeben" (`DOK_ORIGINAL_HINWEIS`).
Der Koordinaten-Testdruck ist als „Positionen im Vordruck prüfen" aus dem Dialog erreichbar.

**Sammelansicht `zeigeVorlagenuebersicht()`** — alle Dokumente mit Stand, Übernahmeart, Belegquelle
und Befund in einer Tabelle, erreichbar über „Alle Vorlagen im Überblick" im Dialog. Entscheidend
für die Brauchbarkeit: sie trennt **offene Befunde** von **bewussten Festlegungen**
(`DOK_BEWUSSTE_FESTLEGUNG`) und fragt eigene Bürodokumente (Vorlage `--`) gar nicht erst nach Stand
und Belegquelle. Ohne diese Trennung meldete sie 17 Befunde, von denen 8 gar keine waren.

Stand danach: 89 Dokumente, 61 Originalvorlagen freigegeben, 6 bewusst festgelegt, 0 offene Befunde.
