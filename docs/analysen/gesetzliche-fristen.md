# Prüfung der automatisch abgeleiteten Fristen

Geprüft am 16.09.2026 anhand der unten verlinkten Gesetzestexte. Gilt für den gemeinsamen Rechenkern `__caseDeadlines`, die Vorschlagsliste, die Fallanlage und die Übernahme über Fallintake/Posteingang.

| Vorschlag | Rechtsgrundlage und Umsetzung |
| --- | --- |
| Anfangsbericht | [§ 1863 Abs. 1 BGB](https://www.gesetze-im-internet.de/bgb/__1863.html): Sollfrist drei Monate nach Bestellung. Die bisherige Pauschale von 28 Tagen wurde durch drei Kalendermonate ersetzt. Die Ausnahme für ehrenamtliche Betreuung bei familiärer Beziehung/persönlicher Bindung wird im Hinweis benannt. |
| Vermögensverzeichnis | [§ 1835 BGB](https://www.gesetze-im-internet.de/bgb/__1835.html) und § 1863 Abs. 1 Satz 3/4 BGB: Bei Vermögensverwaltung ist das Verzeichnis zum Bestellungszeitpunkt zu erstellen und dem Anfangsbericht beizufügen. Statt bisher 42 Tagen wird dessen Dreimonatstermin vorgeschlagen. Ohne Anfangsberichtspflicht besteht keine eigenständige Dreimonatsfrist in § 1835; dies steht im Hinweis. |
| Jahresbericht | § 1863 Abs. 3 BGB: mindestens jährlich. Die Software schlägt einen jährlichen Prüftermin vor, frühestens nach dem ersten Betreuungsjahr. Bisher konnte bei neuen oder zukünftigen Betreuungen bereits der Beginn als Jahresfrist erscheinen. |
| Rechnungslegung | [§ 1865 Abs. 1/2 BGB](https://www.gesetze-im-internet.de/bgb/__1865.html): jährlich bei Vermögensverwaltung; das Gericht bestimmt das Rechnungsjahr. Ein erfasster Abgabetermin hat Vorrang. Sonst wird der Jahrestag ausdrücklich als Plantermin bezeichnet; Befreiungen und gerichtliche Festlegungen sind zu prüfen. |
| Vergütung | [§ 14 VBVG](https://www.gesetze-im-internet.de/vbvg_2023/__14.html): Geltendmachung nach Ablauf von jeweils drei Monaten. Der Vorschlag benennt den Abrechnungsbeginn und liegt erstmals am Tag nach Ablauf des ersten Dreimonatszeitraums. Die bislang möglichen Vorschläge am Betreuungsbeginn und die Lücke zwischen unterschiedlichen Rückblickfenstern entfallen. Die Ausschlussfrist von grundsätzlich 15 Monaten ab Anspruchsentstehung nach [§ 15 Abs. 3 VBVG](https://www.gesetze-im-internet.de/vbvg_2023/__15.html) wird erklärt, aber ohne Anspruchsdaten nicht separat berechnet. |
| Einstweilige Betreuung | [§ 302 FamFG](https://www.gesetze-im-internet.de/famfg/__302.html): grundsätzlich sechs Monate, früherer gerichtlicher Endtermin möglich; Verlängerung durch weitere Anordnungen bis insgesamt ein Jahr. Die irreführende absolute Aussage „längstens sechs Monate“ wurde berichtigt. |
| Überprüfung/Verlängerung | [§ 295 Abs. 2 FamFG](https://www.gesetze-im-internet.de/famfg/__295.html): grundsätzlich spätestens sieben Jahre nach Anordnung; erstmalige Verlängerung bei Anordnung gegen den erklärten Willen spätestens nach zwei Jahren. Konkreter Gerichtstermin hat Vorrang. Die falsche Fundstelle § 1862 Abs. 3 BGB wurde entfernt. Ohne Gerichtstermin bleibt der Siebenjahrestag lediglich eine ausdrücklich gekennzeichnete Orientierung, keine universelle Einreichungsfrist. |

Monatsberechnungen berücksichtigen [§ 188 Abs. 2/3 BGB](https://www.gesetze-im-internet.de/bgb/__188.html), insbesondere das Ende kürzerer Monate. Wiederkehrende Vorschläge werden vom ursprünglichen Datum berechnet, damit sich der Monatstag nicht schrittweise verschiebt. Ungültige Eingaben wie der 30. Februar erzeugen keine Frist.

## Grenzen der Ableitung

Die vorhandenen Stammdaten enthalten nicht sämtliche rechtlich entscheidenden Umstände. Insbesondere können Betreuungsbeginn, eigene Bestellung/Übernahme und Wirksamkeit einer Anordnung auseinanderfallen. Die Hinweise nennen die verwendete Datengrundlage und die maßgeblichen Ausnahmen. Es werden keine Annahmen über persönlichen Bezug, Befreiungen, den erklärten Willen oder ein nicht erfasstes vorzeitiges Ende einer einstweiligen Anordnung getroffen. Regionale Feiertage und eine etwaige Verschiebung nach § 193 BGB werden nicht berechnet; die vorgeschlagenen Kalendertage werden deshalb nicht automatisch nach hinten verlegt. Individuell festgesetzte gerichtliche Termine müssen übernommen bzw. im Fristeneintrag angepasst werden.

## Erkennung bereits übernommener Vorschläge

Vorschläge werden vor der Anzeige mit den gespeicherten Fristen desselben Falls verglichen. Der aktive Fall wird aus dem aktuellen Arbeitsstand gelesen, andere Online-Fälle aus dem Fallcache und lokale Fälle aus dem Fallregister. Eine vorhandene Fall-ID verhindert Verwechslungen gleichnamiger Personen.

Neue Übernahmen speichern die Herkunftsregel samt Ausgangsdatum (`derivedKey`) und die vorgeschlagene Fälligkeit (`derivedDueDate`). Diese Angaben bleiben bei Änderungen, Speicherung und Wiederholungen erhalten. Übernahmen verschwinden unabhängig davon, ob sie in Kalender, Aufgaben, beiden oder nur der Fristenliste geführt werden. Erledigte Einzeltermine werden weiterhin erkannt. Eine offene Wiederholungsserie deckt ihre weiteren Vorschläge ab; ein erledigter Einzeltermin verdeckt dagegen kein neues Berichtsjahr. Nach Löschen einer übernommenen Frist kann der Vorschlag wieder erscheinen.

Für ältere Einträge ohne Herkunftsangabe gibt es einen begrenzten Abgleich über Kategorie, Titel und Termin bzw. die offene Wiederholungsserie. Insbesondere werden die früheren 28-/42-Tage-Termine erkannt. Vorhandene Fälligkeiten werden nicht nachträglich verändert. Vollständig umbenannte und umdatierte Altfristen ohne Herkunftsangabe sind nicht immer eindeutig zuordenbar.

Automatische Prüfungen: `server/tests/html-derived-deadlines.test.cjs`, `server/tests/html-fristen-workspace.test.cjs` sowie die Browserprüfung `server/scripts/qa-fristen-workspace.cjs` mit ausschließlich fiktiven Fällen und abgefangenen Netzwerkzugriffen.
