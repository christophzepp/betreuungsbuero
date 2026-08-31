'use strict';

/* Pruefstand fuer das Vorlagen-Quellmaterial in der Gesamtsicherung (25.08.2026).

   Hintergrund: Die Original-Amtsvordrucke der Vorlagenrunde 08/2026 und die PDF-Quellbestaende
   der Overlay-Werkzeugkette lagen in KEINER Sicherung - die Quellcode-Positivliste nimmt bewusst
   keine Binaerdateien mit. Der Sicherungs-Audit hat das als offene Empfehlung gefuehrt; der
   Nutzer hat die Aufnahme am 25.08.2026 beauftragt.

   Die uebrigen Backup-Prueffaelle stubben den Skriptaufruf (fakeSpawn) - der neue Abschnitt
   wuerde dort nie laufen. Deshalb wird hier der ECHTE Abschnitt aus gesamt-backup.sh
   herausgeschnitten und in einer Sandkasten-Umgebung ausgefuehrt. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SKRIPT = path.join(__dirname, '..', 'tools', 'gesamt-backup.sh');
const quelle = fs.readFileSync(SKRIPT, 'utf8');

function schnitt(von, bis, wieso) {
  const a = quelle.indexOf(von);
  const b = quelle.indexOf(bis, a + von.length);
  assert.ok(a >= 0 && b > a, `${wieso}: Bereich nicht auffindbar`);
  return quelle.slice(a, b);
}

test('Der Quellmaterial-Abschnitt existiert und die Positivliste kennt die Kurations-JSONs', () => {
  assert.ok(quelle.includes('QUELLMATERIAL_BASIS=$BETRIEB/server-ressourcen/vorlagen-quellmaterial'),
    'Ablageort fehlt');
  assert.ok(quelle.includes("--exclude='./render'"),
    'render/ (reproduzierbare Sichtpruefungs-PNG) wird nicht ausgenommen');
  assert.ok(quelle.includes('tools/*.json|tools/*/*.json'),
    'Koordinatenkarten-JSONs fehlen in der Quellcode-Positivliste');
  /* Beide Quellen melden ihr Fehlen als hinweis, nicht als befund - auf fremden Rechnern
     ohne Werkzeugbaum darf die Sicherung nicht scheitern. */
  assert.ok(quelle.includes(`hinweis "Vorlagen-Quellmaterial 'v159-kuratierung/vorlagen-2026-08' nicht vorhanden."`));
  assert.ok(quelle.includes(`hinweis "Vorlagen-Quellmaterial 'pdf-overlay/vorlagen' nicht vorhanden."`));
});

test('Positivlisten-Muster: Kurations-JSON ja, node_modules und PDFs nein (ausgefuehrt)', () => {
  /* Der echte case-Block aus dem Quellarchiv-Abschnitt. */
  const kandidatenBlock = schnitt('case "$QUELL_REL" in', 'esac', 'Positivlisten-case');
  /* Der geschnittene Block traegt sein schliessendes ';;' bereits - nur der Arm-Koerper
     wird auf die Treffermeldung umgebogen und das esac angehaengt. */
  const treiber = `
QUELL_TREFFER=nein
QUELL_REL=$1
${kandidatenBlock.replace('SERVER_QUELLDATEIEN+=("$QUELL_REL")', 'QUELL_TREFFER=ja')}
esac
printf '%s' "$QUELL_TREFFER"
`;
  const probe = (rel) => execFileSync('bash', ['-c', treiber, 'probe', rel], { encoding: 'utf8' });
  assert.equal(probe('tools/v159-kuratierung/koordinaten-karten.json'), 'ja',
    'Koordinatenkarte faellt aus dem Quellarchiv');
  assert.equal(probe('tools/pdf-overlay/package.json'), 'ja');
  assert.equal(probe('tools/pdf-overlay/node_modules/x/package.json'), 'nein',
    'node_modules ruecken ins Quellarchiv');
  /* Der Vorbefund, den dieser Prueffall beim ersten Lauf selbst fand: '*' matcht in
     case-Mustern auch '/', tools/(*)/(*).js zog die node_modules mit - entgegen der
     ausdruecklichen Zusage der Positivliste. Der Wachposten haelt beides draussen. */
  assert.equal(probe('tools/pdf-overlay/node_modules/@cantoo/pdf-lib/cjs/index.js'), 'nein',
    'der dokumentierte node_modules-Ausschluss gilt nicht fuer .js');
  assert.equal(probe('tools/pdf-overlay/vorlagen/tpl_kg1.flach.pdf'), 'nein',
    'PDFs gehoeren in den Quellmaterial-Ordner, nicht ins tar.gz des Quellcodes');
  assert.equal(probe('src/database/index.js'), 'ja', 'Bestandsmuster beschaedigt');
});

test('Der echte Abschnitt kopiert PDFs und laesst render/ zurueck (ausgefuehrt)', () => {
  const abschnitt = schnitt('QUELLMATERIAL_BASIS=$BETRIEB/server-ressourcen/vorlagen-quellmaterial',
    '\n\n# Die laufende Serverimplementierung', 'Quellmaterial-Abschnitt');
  const kopiereBaum = schnitt('kopiere_baum() {', '\n}', 'kopiere_baum') + '\n}';

  const sandkasten = fs.mkdtempSync(path.join(os.tmpdir(), 'quellmaterial-'));
  try {
    const serverDir = path.join(sandkasten, 'server');
    const betrieb = path.join(sandkasten, 'betrieb');
    const kur = path.join(serverDir, 'tools', 'v159-kuratierung', 'vorlagen-2026-08');
    const ovl = path.join(serverDir, 'tools', 'pdf-overlay', 'vorlagen');
    fs.mkdirSync(kur, { recursive: true });
    fs.mkdirSync(path.join(ovl, 'render'), { recursive: true });
    fs.mkdirSync(betrieb, { recursive: true });
    fs.writeFileSync(path.join(kur, 'BS10_Vermoegensverzeichnis_01-2023.pdf'), 'PDF-A');
    fs.writeFileSync(path.join(ovl, 'tpl_kg1.acroform.pdf'), 'PDF-B');
    fs.writeFileSync(path.join(ovl, 'render', 'probe.png'), 'PNG-WEG');

    /* baum_signatur wird gestubbt (konstant) - die Konsistenzpruefung ist hier nicht das
       Pruefziel, die Kopiersemantik ist es. hinweis/befund werden mitgeschrieben. */
    const treiber = `
set -u
PROGRAMM=pruefstand
SERVER_DIR=${JSON.stringify(serverDir)}
BETRIEB=${JSON.stringify(betrieb)}
hinweis() { printf 'HINWEIS:%s\\n' "$1" >> "$BETRIEB/.meldungen"; }
befund() { printf 'BEFUND:%s\\n' "$1" >> "$BETRIEB/.meldungen"; }
baum_signatur() { printf 'stabil'; }
${kopiereBaum}
kopiere_laufzeitbaum_konsistent() {
  local quelle=$1 ziel=$2 bezeichnung=$3 vor nach
  vor=$(baum_signatur "$quelle") || return 2
  kopiere_baum "$quelle" "$ziel" || return 2
  nach=$(baum_signatur "$quelle") || return 2
  [[ $vor == "$nach" ]]
}
${abschnitt}
`;
    execFileSync('bash', ['-c', treiber], { encoding: 'utf8' });

    const basis = path.join(betrieb, 'server-ressourcen', 'vorlagen-quellmaterial');
    assert.ok(fs.existsSync(path.join(basis, 'v159-kuratierung', 'vorlagen-2026-08',
      'BS10_Vermoegensverzeichnis_01-2023.pdf')), 'Amtsvordruck nicht kopiert');
    assert.ok(fs.existsSync(path.join(basis, 'pdf-overlay', 'vorlagen', 'tpl_kg1.acroform.pdf')),
      'Overlay-Quelle nicht kopiert');
    assert.ok(!fs.existsSync(path.join(basis, 'pdf-overlay', 'vorlagen', 'render')),
      'render/ wurde mitkopiert - 80 MB reproduzierbare PNG in jeder Sicherung');
    assert.ok(!fs.existsSync(path.join(betrieb, '.meldungen')), 'unerwartete Meldung');

    /* Fehlende Quellen: hinweis statt Abbruch. */
    fs.rmSync(kur, { recursive: true });
    fs.rmSync(path.join(betrieb, 'server-ressourcen'), { recursive: true });
    execFileSync('bash', ['-c', treiber], { encoding: 'utf8' });
    const meldungen = fs.readFileSync(path.join(betrieb, '.meldungen'), 'utf8');
    assert.match(meldungen, /^HINWEIS:.*v159-kuratierung/m, 'fehlende Quelle bricht die Sicherung');
    assert.ok(!meldungen.includes('BEFUND:'), 'hinweis wurde zum befund');
  } finally {
    fs.rmSync(sandkasten, { recursive: true, force: true });
  }
});

test('Der Restore laesst unbekannte Betriebs-Pfade bewusst liegen', () => {
  /* Der Quellmaterial-Ordner gehoert in den Werkzeugbaum, nicht in eine Laufzeit-Stage -
     der Fallback des Restore muss ihn ueberspringen statt zu sterben. */
  const restore = fs.readFileSync(path.join(__dirname, '..', 'tools', 'gesamt-restore.sh'), 'utf8');
  const block = restore.slice(restore.indexOf('betrieb/browser-erweiterungen/*)'),
    restore.indexOf('Leerer Betriebsartefaktpfad'));
  assert.ok(/\*\)\s*continue\s*;;/.test(block), 'Restore stirbt an unbekannten betrieb/-Pfaden');
  assert.ok(!block.includes('vorlagen-quellmaterial'),
    'Quellmaterial wurde in eine Laufzeit-Stage verdrahtet - das ist nicht gewollt');
});
