# Falldaten zuverlässig speichern – 20.09.2026

## Reproduzierter Befund

Im ausgelieferten HTML wurde der gemeinsame PATCH der Falldaten um 600 ms verzögert.
HTTP-Fehler und Netzfehler wurden im normalen Speicherweg verschluckt. Auch der beim
Fallwechsel aufgerufene Flush meldete keinen Fehler. Im Browser ließ sich dies mit
Lebensunterhalt und Gesundheitsdaten sowie einer absichtlichen 503-Antwort nachstellen:
Die Änderungen standen weiter im Arbeitsspeicher, waren serverseitig nicht gespeichert,
und der Flush kehrte ohne Fehlermeldung zurück. Online werden diese Falldaten bewusst
nicht zusätzlich im localStorage gespeichert.

Weitere nachgewiesene Risiken: `pagehide` löschte ausstehende Timer; mehrere PATCHes
konnten gleichzeitig laufen; verspätete Antworten verwendeten die globale Vergleichsbasis;
einzelne Desktop-Felder übernahmen Eingaben erst beim Fokuswechsel.

## Korrektur

- Eine gemeinsame Warteschlange serialisiert die Stammdaten-PATCHes. Neue Änderungen
  während einer Anfrage werden danach übertragen. Ziel-Fall und Ladegeneration werden
  vor der Anfrage festgehalten; die Vergleichsbasis wird erst nach bestätigtem Erfolg
  aktualisiert. Der Server muss eine erfolgreiche JSON-Bestätigung liefern.
- Sichtbarer Status für ausstehende, laufende, bestätigte und fehlgeschlagene Speicherung.
  Fehler behalten den Entwurf im Arbeitsspeicher; Wiederholung erfolgt automatisch mit
  begrenztem Backoff und zusätzlich auf Knopfdruck bzw. nach Wiederkehr des Netzes.
- Fallwechsel, normales Schließen und Archivieren warten auf die Speicherung. Bei einem
  Fehler bleiben die Falldaten geöffnet. Bereits endgültig gelöschte Fälle werden ohne
  weiteren Schreibversuch geschlossen.
- Hintergrundwechsel und `pagehide` senden ausstehende Änderungen, statt Timer zu
  verwerfen. Kleine PATCHes verwenden `keepalive`; größere Nutzlasten bleiben normale
  Anfragen. Der Browser warnt beim Neuladen/Verlassen, solange Änderungen offen sind.
- Gesundheit und Lebensunterhalt übernehmen Desktop-Eingaben schon während des Tippens.
  Dokumentationsspiegelungen und das Neuzeichnen von Beträgen bleiben am Feldwechsel.
- Mobile Fallformulare, Lebensunterhalt und Desktop-Schnellmasken warten vor Abschluss
  auf die Serverbestätigung. Wiederholen eines bereits angelegten Eintrags erzeugt
  keine zweite Kopie. Ersetzen ganzer Datenabschnitte aktualisiert auch den Fall-Cache.
- Lokale Quotenfehler werden an den aufrufenden Editor weitergegeben.

## Prüfung

`server/tests/html-case-persistence.test.cjs` führt den tatsächlichen Realtime-Skriptblock
mit kontrollierten Antworten aus. Geprüft werden Bestätigung, HTTP 401/403/413/500/503,
Netzausfall, falsche Erfolgsantwort, automatische Wiederholung, konkurrierende Schreibaufrufe,
verspätete Antworten bei Fallwechsel, Cache, Neuladen, Hintergrundwechsel, UTF-8-Größenlimit
für keepalive und Fehler des lokalen Browser-Speichers.

`server/scripts/qa-case-persistence.cjs` verwendet das ausgelieferte HTML in Chromium
und WebKit, echte Fall-Routen und eine separate temporäre SQLite-Datenbank. Ausschließlich
synthetische Falldaten. Geprüft werden tatsächliche Datenbankwerte, Neuladen, verzögerte
Bestätigung, Fehler/Wiederholung ohne Duplikate, Desktop-Eingaben ohne Fokuswechsel,
Fallwechsel und Schließen bei einem Speicherfehler sowie Desktop-Schnellmasken.
Die Anmeldung wird im Prüfstand simuliert. Eine beim Navigieren abgebrochene Hintergrund-
GET-Abfrage der synthetischen Fallliste wird in WebKit separat protokolliert; unerwartete
JavaScript-Fehler bleiben Testfehler.

Abschließende vollständige Testsuite: **1.598 Tests bestanden**, einschließlich elf neuer
Persistenztests. Der Praxislauf mit echten Fall-Routen und temporärer SQLite-Datenbank
bestand in **Chromium und WebKit**.

## Grenzen

Die Korrektur betrifft die Falldaten und deren Bestätigungen, nicht eine allgemeine
Neuentwicklung sämtlicher separater Speicher-Endpunkte. Erzwungenes Beenden des Browsers
oder Neuladen trotz Warnung während eines dauerhaften Netz-/Serverfehlers kann unbestätigte
Entwürfe weiterhin verwerfen; es wird keine zusätzliche Kopie sensibler Online-Falldaten
im Browser angelegt. Bestehende verlorene Daten wurden nicht rekonstruiert. Änderungen
sind lokal; kein Deployment und keine Veröffentlichung in diesem Arbeitsschritt.
