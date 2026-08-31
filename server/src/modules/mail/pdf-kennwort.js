// PDF-Kennwortschutz beim Mail-Versand (PDF-Umbauplan Phase 5.7, umgesetzt 13.08.2026).
// Anlagen, die ein pdfKennwort tragen und PDFs sind, werden vor dem Versand mit dem
// PDF-Standard-Security-Handler verschluesselt (AES-128/R4 ueber @cantoo/pdf-lib —
// bewusst NICHT das R5/AES-256-Schema des Forks, das kryptographisch schwaecher
// designt und weniger kompatibel ist als der bewaehrte R4-Handler).
// Scheitert die Verschluesselung, bricht der Versand ab — eine gewollt geschuetzte
// Anlage darf NIE unverschluesselt hinausgehen. Das Kennwort wird nirgends gespeichert
// und gehoert laut Konzept (§ 35 SGB I) getrennt uebermittelt, z. B. telefonisch.

const { PDFDocument } = require('@cantoo/pdf-lib');

function istPdf(anlage) {
  const mime = String(anlage.mimeType || '').toLowerCase();
  const name = String(anlage.filename || '').toLowerCase();
  return mime === 'application/pdf' || name.endsWith('.pdf');
}

// attachments: [{ filename, mimeType, content: Buffer, pdfKennwort?: string }]
// kennwortFuerAlle: requestweites Kennwort (Checkbox „Anhänge schützen“) — gilt dann
// fuer JEDEN Anhang der Mail; ein Nicht-PDF-Anhang bricht den Versand bewusst ab,
// damit nie ein Teil der Sendung ungeschuetzt hinausgeht.
// Ersetzt content in-place durch die verschluesselte Fassung und entfernt pdfKennwort.
async function schuetzePdfAnlagen(attachments, kennwortFuerAlle) {
  const gesamt = String(kennwortFuerAlle || '').trim();
  for (const anlage of attachments || []) {
    const kennwort = String(anlage.pdfKennwort || '').trim() || gesamt;
    delete anlage.pdfKennwort;
    if (!kennwort) continue;
    if (!istPdf(anlage)) {
      throw new Error(`Kennwortschutz ist nur für PDF-Anhänge möglich („${anlage.filename}“ ist keine PDF). Bitte den Anhang entfernen oder den Schutz deaktivieren.`);
    }
    try {
      const pdf = await PDFDocument.load(anlage.content, { updateMetadata: false });
      pdf.encrypt({
        userPassword: kennwort,
        ownerPassword: kennwort,
        permissions: {
          printing: 'highResolution',
          fillingForms: true,          // Formularfelder bleiben ausfuellbar (kein Flattening-Konzept)
          contentAccessibility: true,  // Vorlese-Zugriff bleibt erlaubt
          modifying: false,
          copying: false,
          annotating: false,
          documentAssembly: false
        }
      });
      anlage.content = Buffer.from(await pdf.save({ useObjectStreams: false }));
    } catch (fehler) {
      throw new Error(`PDF-Kennwortschutz für „${anlage.filename}“ fehlgeschlagen: ${fehler.message || fehler}`);
    }
  }
  return attachments;
}

// Inhalt der separaten Kennwort-E-Mail (Option „Kennwort zusätzlich per E-Mail senden“).
function kennwortMailInhalt(betreff, kennwort) {
  const bezug = String(betreff || '').trim() || 'Dokumentversand';
  return {
    subject: `Kennwort zur E-Mail „${bezug}“`,
    body: `Sehr geehrte Damen und Herren,\n\nzu unserer separaten E-Mail „${bezug}“ erhalten Sie hiermit das Kennwort für die geschützten PDF-Anhänge:\n\n${kennwort}\n\nBitte behandeln Sie dieses Kennwort vertraulich.\n\nMit freundlichen Grüßen`
  };
}

module.exports = { schuetzePdfAnlagen, kennwortMailInhalt };
