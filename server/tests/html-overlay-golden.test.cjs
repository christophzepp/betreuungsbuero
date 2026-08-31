'use strict';
/* Render-Vergleichstest (PDF-Umbauplan Phase 5.5, 13.08.2026): baut fuer drei repraesentative
   Overlay-Dokumente (Overlay-Karte / Koordinaten-Konvertierung mit Radios / Tabellen) die
   Probe-PDF deterministisch aus Karte+Musterdaten neu, rendert ausgewaehlte Seiten und
   vergleicht sie pixelweise gegen die abgenommenen Golden-Referenzen in tests/golden/.
   Layout-Regressionen (verrutschte Felder, andere Schriftgroessen) fallen so im Pruefstand auf.

   Golden bewusst AKTUALISIEREN (nur nach Sichtpruefung!):
     GOLDEN_AKTUALISIEREN=1 node --test tests/html-overlay-golden.test.cjs

   Voraussetzungen: macOS (sips), python3+PIL, server/tools/pdf-overlay/node_modules (pdf-lib).
   Fehlen sie (z. B. Docker/CI), wird der Test uebersprungen. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WERKZEUG = path.join(__dirname, '..', 'tools', 'pdf-overlay');
const GOLDEN = path.join(__dirname, 'golden');
const AKTUALISIEREN = process.env.GOLDEN_AKTUALISIEREN === '1';

const FAELLE = [
  { reportId: 'rent_certificate', el: 'tpl_v159_rent_certificate', seiten: { 1: 'rent_certificate_s1.png' } },
  { reportId: 'child_benefit_diversion', el: 'tpl_kg11e', seiten: { 1: 'kg11e_s1.png', 2: 'kg11e_s2.png' } },
  { reportId: 'child_benefit_application', el: 'tpl_kg1', seiten: { 3: 'kg1_s3.png' } },
];

function verfuegbar() {
  try { execFileSync('sips', ['--help'], { stdio: 'ignore' }); } catch (_e) { return 'sips fehlt (kein macOS)'; }
  try { execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }); } catch (_e) { return 'python3/PIL fehlt'; }
  if (!fs.existsSync(path.join(WERKZEUG, 'node_modules', 'pdf-lib'))) return 'tools/pdf-overlay/node_modules fehlt';
  return null;
}

test('Overlay-Probe-Renderings entsprechen den abgenommenen Golden-Referenzen', { timeout: 300000 }, (t) => {
  const grund = verfuegbar();
  if (grund) { t.skip('uebersprungen: ' + grund); return; }

  for (const fall of FAELLE) {
    /* Kette deterministisch neu bauen: exportieren -> praegen -> fuellen -> flatten -> rendern. */
    execFileSync('node', ['vorlage-export.js', fall.el], { cwd: WERKZEUG, stdio: 'ignore' });
    execFileSync('node', ['overlay-praegen.js', fall.reportId], { cwd: WERKZEUG, stdio: 'ignore' });
    execFileSync('node', ['probe-fuellen.js', fall.reportId], { cwd: WERKZEUG, stdio: 'ignore' });
    execFileSync('node', ['-e', `
const fs=require('fs');const {PDFDocument,StandardFonts}=require('pdf-lib');
(async()=>{const pdf=await PDFDocument.load(fs.readFileSync('vorlagen/${fall.el}.probe.pdf'),{ignoreEncryption:true});
const form=pdf.getForm();const helv=await pdf.embedFont(StandardFonts.Helvetica);
form.updateFieldAppearances(helv);form.flatten();
fs.writeFileSync('vorlagen/${fall.el}.golden.pdf',await pdf.save({useObjectStreams:false}))})().catch(e=>{console.error(e);process.exit(1)})
`], { cwd: WERKZEUG, stdio: 'ignore' });
    execFileSync('node', ['seiten-rendern.js', `vorlagen/${fall.el}.golden.pdf`], { cwd: WERKZEUG, stdio: 'ignore' });

    for (const [seite, goldenName] of Object.entries(fall.seiten)) {
      const istPfad = path.join(WERKZEUG, 'vorlagen', 'render', `${fall.el}.golden_s${seite}.png`);
      const sollPfad = path.join(GOLDEN, goldenName);
      assert.ok(fs.existsSync(istPfad), 'Render fehlt: ' + istPfad);
      if (AKTUALISIEREN) { fs.copyFileSync(istPfad, sollPfad); continue; }
      assert.ok(fs.existsSync(sollPfad), 'Golden fehlt: ' + sollPfad + ' (mit GOLDEN_AKTUALISIEREN=1 erzeugen)');
      /* Pixelvergleich mit Toleranz: mittlere Abweichung < 1.5 Graustufen, stark abweichende
         Pixel (>32) < 0.4 % der Flaeche. Faengt verrutschte Felder, ignoriert Renderrauschen. */
      const urteil = execFileSync('python3', ['-c', `
from PIL import Image, ImageChops
import sys
a=Image.open(${JSON.stringify(istPfad)}).convert('L'); b=Image.open(${JSON.stringify(sollPfad)}).convert('L')
if a.size!=b.size: print('GROESSE', a.size, b.size); sys.exit(0)
d=ImageChops.difference(a,b)
h=d.histogram(); gesamt=a.size[0]*a.size[1]
mittel=sum(i*n for i,n in enumerate(h))/gesamt
stark=sum(n for i,n in enumerate(h) if i>32)/gesamt
print('OK' if (mittel<1.5 and stark<0.004) else 'ABWEICHUNG', round(mittel,3), round(stark*100,3))
`], { encoding: 'utf8' }).trim();
      assert.ok(urteil.startsWith('OK'), `${fall.reportId} Seite ${seite}: ${urteil} (mittlere Abw. / % stark abweichende Pixel) — bei gewollter Layoutaenderung Golden nach Sichtpruefung aktualisieren`);
    }
  }
});
