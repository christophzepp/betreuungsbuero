'use strict';
/* Prototyp-sicheres Schreiben ueber Pfadangaben (Sicherheitsaudit 2026-07-26, Befund B1).
 *
 * Vorgeschichte: An ZWEI Stellen lief ein vom Client gelieferter Pfad ("person.geburtsdatum")
 * Segment fuer Segment durch ein Objekt und legte fehlende Ebenen mit {} an -
 *   - mcp-tools.js, KINDS.stammdaten (KI-Fernzugriff, Vorschlagsmechanik)
 *   - routes/cases.js, applyPatches (PATCH /api/cases/:id/stammdaten und /reports/:reportId)
 * Beide betraten dabei auch das Segment "__proto__": aus "person.__proto__.viewAllCases" wurde
 * eine Eigenschaft auf Object.prototype, die im GANZEN Prozess sichtbar war. permissions.js
 * pruefte mit "key in branch" - und "in" greift auf die Prototypenkette durch. Damit wurde aus
 * einem Schreibfehler eine prozessweite Rechteausweitung fuer JEDES Konto, auch fuer die
 * normale Web-Anmeldung, bis zum Serverneustart.
 *
 * Zwei UNABHAENGIGE Verteidigungslinien, bewusst beide - eine allein waere zu leicht zu umgehen:
 *
 *   1. Segment-Blacklist (pfadPruefen): '__proto__', 'constructor' und 'prototype' sind als
 *      GANZES Segment verboten. Vergleich per === gegen eine ausdrueckliche Liste, kein
 *      Regex-Feinschliff - Regexe fuer diesen Zweck sind erfahrungsgemaess umgehbar.
 *
 *   2. Sicherer Walk (setzen): betreten wird nur, was eine EIGENE Eigenschaft ist
 *      (Object.prototype.hasOwnProperty.call); neu angelegte Ebenen entstehen als
 *      Object.create(null) und haben damit ueberhaupt keine Prototypenkette mehr; geschrieben
 *      wird mit Object.defineProperty, das nie einen Setter der Kette ausloest. Selbst wenn ein
 *      Segment die Blacklist kuenftig durchrutschen sollte, kann es Object.prototype nicht mehr
 *      erreichen.
 *
 * Warum Object.create(null) unbedenklich ist: die so erzeugten Zwischenobjekte werden noch im
 * selben Vorgang mit JSON.stringify persistiert (JSON.stringify kommt mit prototyplosen Objekten
 * einwandfrei zurecht) und beim naechsten Lesen von JSON.parse als ganz normale Objekte
 * zurueckgegeben. Die fehlende Prototypenkette lebt also nur bis zum Speichern.
 *
 * Nebenbefunde des Audits, hier gleich mitbehandelt (alle drei waren stille Datenverluste):
 *   - Listen-Loecher: "banks.5.iban" bei 2 Eintraegen erzeugte [obj,obj,null,null,null,obj].
 *     Jetzt: Index groesser als die Laenge wird abgewiesen (Anhaengen am Ende bleibt erlaubt).
 *   - Nicht existierender Listenpfad wurde ein OBJEKT ({"0":{...}}) statt einer Liste - der
 *     Client verlor die Liste beim naechsten Array.isArray-Test. Jetzt: ist das FOLGE-Segment
 *     eine reine Zahl, entsteht eine Liste.
 *   - Ein skalarer Zwischenknoten wurde kommentarlos ueberschrieben ("person.birthDate.year"
 *     machte aus "1950-01-01" ein {year:1950}). Jetzt: gefuellte Skalare werden abgewiesen;
 *     leere Zwischenwerte ('' / null) duerfen weiterhin zum Objekt werden, damit das Anlegen
 *     noch nicht befuellter Felder unveraendert funktioniert.
 */

/* Als ganzes Pfadsegment verbotene Namen. Bewusst eine Liste und kein Regex. */
const VERBOTENE_SEGMENTE = ['__proto__', 'constructor', 'prototype'];

const eigen = (o, k) => Object.prototype.hasOwnProperty.call(Object(o), k);

function segmentVerboten(segment) {
  const s = String(segment);
  for (const v of VERBOTENE_SEGMENTE) if (s === v) return true;
  return false;
}

/* Wirft bei einem verbotenen Segment. Nutzbar auch ohne setzen(), z.B. um einen Pfad frueh
   abzulehnen, bevor ueberhaupt Daten geladen werden. */
function pfadPruefen(segmente) {
  const teile = Array.isArray(segmente) ? segmente : String(segmente == null ? '' : segmente).split('.');
  if (!teile.length || teile.some(t => String(t) === '')) {
    throw new Error('Pfad ist leer oder enthält ein leeres Segment.');
  }
  for (const t of teile) {
    if (segmentVerboten(t)) throw new Error('Pfadsegment nicht erlaubt: ' + String(t));
  }
  return teile.map(String);
}

/* Immer eine EIGENE Eigenschaft schreiben - defineProperty umgeht jeden geerbten Setter. */
function eigenSetzen(knoten, schluessel, wert) {
  Object.defineProperty(knoten, schluessel, { value: wert, writable: true, enumerable: true, configurable: true });
}

/* Schreibt wert an den Pfad. Optionen:
     listenPfadeVerboten - true: sobald der Walk in einer Liste landet, Abbruch (Stammdaten-
                           Vorschlaege des KI-Fernzugriffs duerfen bewusst nur Skalare setzen).
   Rueckgabe: die Wurzel. */
function setzen(wurzel, pfad, wert, optionen) {
  const opt = optionen || {};
  const teile = pfadPruefen(pfad);
  if (wurzel === null || typeof wurzel !== 'object') throw new Error('Zielobjekt fehlt.');

  let knoten = wurzel;
  for (let i = 0; i < teile.length - 1; i++) {
    const s = teile[i];
    if (opt.listenPfadeVerboten && Array.isArray(knoten)) throw new Error('Listenpfade sind hier nicht erlaubt.');
    pruefeListenIndex(knoten, s);
    const vorhanden = eigen(knoten, s) ? knoten[s] : undefined;
    if (vorhanden !== null && typeof vorhanden === 'object') {
      knoten = vorhanden;
      continue;
    }
    if (vorhanden !== undefined && vorhanden !== null && vorhanden !== '') {
      throw new Error('Pfad "' + teile.slice(0, i + 1).join('.') + '" enthält bereits einen Wert; '
        + 'er kann nicht zusätzlich als Unterobjekt beschrieben werden.');
    }
    /* Folgt eine reine Zahl, gehoert an diese Stelle eine LISTE - sonst entstuende {"0":…}. */
    const neu = /^\d+$/.test(String(teile[i + 1])) ? [] : Object.create(null);
    eigenSetzen(knoten, s, neu);
    knoten = neu;
  }
  if (opt.listenPfadeVerboten && Array.isArray(knoten)) throw new Error('Listenpfade sind hier nicht erlaubt.');
  const letztes = teile[teile.length - 1];
  pruefeListenIndex(knoten, letztes);
  eigenSetzen(knoten, letztes, wert);
  return wurzel;
}

/* Listen duerfen am Ende wachsen (Index === Laenge), aber keine Loecher bekommen. */
function pruefeListenIndex(knoten, segment) {
  if (!Array.isArray(knoten)) return;
  const s = String(segment);
  if (!/^\d+$/.test(s)) throw new Error('Listen brauchen einen Zahlenindex, nicht "' + s + '".');
  const i = Number(s);
  if (i > knoten.length) {
    throw new Error('Listenindex ' + i + ' liegt hinter dem Ende der Liste (' + knoten.length + ' Einträge) - '
      + 'das würde Lücken erzeugen.');
  }
}

module.exports = { VERBOTENE_SEGMENTE, segmentVerboten, pfadPruefen, setzen, eigen };
