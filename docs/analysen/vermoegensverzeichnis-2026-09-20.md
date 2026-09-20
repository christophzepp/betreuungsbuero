# Vermögensverzeichnis: Vorlage und PDF-Export (20.09.2026)

## Herkunft der bereitgestellten Vorlage

Die vom Nutzer bereitgestellte `VVZ.pdf` gehört zur Formularreihe **BS 10**,
Druckerei **JVA Willich I**, Stand **02/2012**. Das steht am linken Rand der ersten
Seite. Einen Vordruck derselben Reihe veröffentlicht das
[Amtsgericht Schmallenberg](https://www.ag-schmallenberg.nrw.de/behoerde/Formulare-und-Antraege/Vermoegensverzeichnis.pdf).
Die Quelle belegt die Formularfamilie; sie ist **kein Nachweis der konkreten
Downloadquelle oder eines bytegleichen Originals** der übergebenen Datei.

Metadaten der übergebenen Datei: Titel `BS 010`, Creator `CorelDRAW X5`, Producer
`Corel PDF Engine Version 15.0.0.486`, Erstellung 27.04.2015, letzte Änderung
13.06.2026. Das Änderungsdatum ist nicht der Formularstand. SHA-256 der Eingabe:
`aaaee681c123ba0037be4c9c8cde49c3a5c9de6c2a1457083bd2c12f7c9e4e49`.

Die Vorlage enthält historische Gesetzesverweise (§§ 1802, 1908i, 1915 und
1836 c BGB) sowie die alte Bezeichnung „Pflegestufe“. Die aktuelle Vorschrift zum
Vermögensverzeichnis ist [§ 1835 BGB](https://www.gesetze-im-internet.de/bgb/__1835.html).
Der Nutzer hat genau diese Vorlage angefordert: Das Formularlayout und seine
historischen Texte werden daher übernommen, nicht als amtlicher Stand 2026
umetikettiert. Die Dokumenteninformationen benennen den tatsächlichen Stand.

## Ursachen und Umsetzung

Der alte Export beschrieb die Fassung von 2023 mit einer nicht passenden Feldkarte.
Kontonummern und Banken teilten sich teilweise ein Feld, Beträge kreuzten Linien,
der zweite Übertrag verlor die Summe der ersten Seite, Einkünfte/Ausgaben wurden
nur als Gesamtsummen an Überschriften geschrieben. Der eigene Exportpfad wertete
die Unterschriftauswahl nicht aus. Die alte eingebettete Vorlage enthielt zudem
vorgedruckte Werte und ein fremdes Datum.

Die neue Eingabe ist mit leerem Passwort verschlüsselt. `prepare-vvz.py` schreibt
mit pypdf eine unverschlüsselte Arbeitskopie, ohne die Quelldatei zu verändern.
Diese Arbeitskopie ist im bisherigen Template-Block eingebettet. Die Datei
enthält außerdem doppelte Widgets außerhalb der Seite und ein invertiertes
Datumsrechteck. Deshalb werden beim Export die alten Widgets und Formularaktionen
entfernt und 116 eindeutig benannte AcroForm-Felder mit geprüften Positionen und
aktuellen Appearances erzeugt. Der Export bleibt ein interaktives PDF. Es werden
keine durch Acrobat-JavaScript berechneten Altwerte übernommen.

- A4-Seiten, transparente Formularfelder ohne zusätzliche Kästen; getrennte
  Kontonummern, Institute und rechtsbündige Beträge mit einheitlichem Zahlenformat.
- Kategoriesummen und fortlaufende Überträge in Cent gerechnet. Sparkonten und
  Bausparverträge werden vor allgemeinen Kontobezeichnungen erkannt. Zusätzliche
  Kategorien für Forderungen, Hausrat und Gesamthandsgemeinschaften.
- Alle Einzelposten auf paginierten Anlagen. Weitere Konten und nicht passend
  darstellbare Angaben erhalten einen Anlagenverweis; keine still gekürzten Texte.
- Einnahmen und Ausgaben werden in die einzelnen Formularrubriken einsortiert.
  Neue Berichte übernehmen Ausgaben aus dem Lebensunterhalt. Alte Berichte ohne
  Einzelaufstellung behalten ihre damalige Gesamtsumme mit entsprechender Kennzeichnung.
- Zusätzliche bearbeitbare Felder für Schenkungen, Angehörige, Ort und Unterschriftsdatum.
- Die gewählte Betreuerunterschrift erscheint im vergrößerten Unterschriftsbereich.
  „Freilassen“ bleibt leer. Eine explizit gewählte, fehlende oder nicht einbettbare
  Unterschrift führt zu einer verständlichen Fehlermeldung. Keine erfundene
  Kenntnisnahme oder Unterschrift der betreuten Person.
- Schnappschüsse verwenden ausschließlich die gespeicherten Berichtsfelder.
- Kombinierte Exporte registrieren die kopierten VVZ-Widgets auch im AcroForm-Baum;
  jeder Bestandteil erhält einen eigenen Namensraum. Sichtbare Werte und logische
  Formularwerte bleiben dadurch konsistent.

## Prüfung

`server/tests/html-asset-inventory-export.test.cjs` prüft echte PDFs: Summen,
Überträge, Feldpositionen, Appearances, Überlauf, Altbestand, fehlende Signaturen
und lange Anlagen. `server/scripts/qa-asset-inventory.cjs` lädt die tatsächlich
ausgelieferte HTML im Browser und prüft Schema, Originalexport, gewählte
Musterunterschrift, Schnappschussdaten und Kombination mehrerer VVZ-Dokumente.

Die gerenderten Seiten des synthetischen Beispielexports wurden einzeln auf
Überlagerungen, Linien, Beträge, Unterschrift und vollständige Anlagen geprüft.
Personenbezogene Daten aus dem mitgebrachten fehlerhaften Export werden nicht
als Testdaten oder Repository-Dateien übernommen. Diese Änderungen sind lokal;
keine neue Beta-Veröffentlichung ist Bestandteil dieser Vorlagenkorrektur.

Erste Vorlagenprüfung: `npm test` erfolgreich, **1.585 Tests**, keine Fehler oder übersprungenen
Tests. Browserprüfung erfolgreich. Zusätzlich mit pypdf erneut geöffnet: 116
kanonische Felder und Widgets im Original, 232 in der Kombination zweier
Berichte; Werte, Parent-Verknüpfungen, Appearances und Rechtecke stimmen überein.

## Layout-Nachprüfung mit neuen Daten

Zusätzliche synthetische Prüfdaten enthalten acht Konten, lange Namen und
Institutsbezeichnungen, 14 Angehörige, mehrzeilige Angaben, Referenzen ohne
Leerzeichen, große und negative Beträge sowie seitenlange Ergänzungen.
Dabei wurden weitere Layoutprobleme behoben:

- Platzprüfung und PDF-Appearance verwenden jetzt dieselben Fontmetriken und
  Zeilenumbrüche. Kurze Formularfelder verlieren keine expliziten Zeilenumbrüche;
  lange Referenzen werden bei Bedarf innerhalb des Feldes umgebrochen.
- Sparkonto-Felder bieten Platz für eine vollständige IBAN. Die Beschriftung
  „IBAN/Konto“ ersetzt dort das schmale historische Sparbuchnummer-Feld.
- Beschreibungen und zugehörige Beträge beginnen in den Rubriken auf gleicher Höhe.
  Summen, Überträge und einzeilige Stammdaten behalten ihre vertikale Ausrichtung.
- Die Schreiblinien bei Schenkungen und im ausgefüllten Lagefeld des Grundbesitzes
  kreuzen keine mehrzeiligen Texte. Zusätzlicher Abstand zur Fahrzeug-Beschriftung.
- Anlagen vermeiden wiederholte vollständige Angaben, die bereits als Einzelposten
  enthalten sind. Angehörigen-Verweise sind nummeriert; mehr als zehn Angehörige
  werden im Formular ausdrücklich angekündigt.
- Posten bleiben nach Möglichkeit auf einer Seite. Lange Absätze werden vollständig
  fortgesetzt; Rubriken werden auf Fortsetzungsseiten wiederholt. Überschriften und
  Summen bleiben beim zugehörigen Inhalt. Die Betragsspalte richtet ihre Breite nach
  dem längsten Betrag; der laufende Kopf bleibt auch bei extrem langen Namen begrenzt.

Die vollständige Testsuite besteht mit **1.587 Tests**. Nach der letzten
Abstandskorrektur wurden die 19 betroffenen Regressionstests und die Browserprüfung
erneut ausgeführt. Geprüft werden tatsächliche PDFs, Feld-Appearances, vollständige
Texte, Seitengrenzen, Überschriften, Schnappschüsse und kombinierte Exporte.
Die Browserprüfung erstellt zusätzlich einen Export mit freigelassener Unterschrift
und mehrzeiligen Schenkungsangaben. Die gerenderten Standard- und Belastungsfälle
wurden visuell geprüft. Alle Änderungen bleiben lokal.
