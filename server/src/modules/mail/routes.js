// Generischer Mail-Versand (Phase 6, Plan Abschnitt Z) - fuer den Lokal-Modus, wo es keinen
// serverseitigen Fall-Datensatz gibt, an den der Versand gebunden werden koennte (im Online-Modus
// nutzt der Mail-Editor stattdessen den fallgebundenen Endpunkt in routes/cases.js, der zusaetzlich
// den Dokumenten-Zwischenspeicher einbindet). Beide Endpunkte rufen letztlich dieselbe
// buerobezogene SMTP-Konfiguration ueber server/mail.js auf.

const express = require('express');
const db = require('../../database/index');
const { requireAuth, requireSendMail } = require('../../middleware/authentication');
const mail = require('./service');
const { schuetzePdfAnlagen, kennwortMailInhalt } = require('./pdf-kennwort');

const router = express.Router();
router.use(requireAuth);

// Mail-Signatur fuer den Mail-Editor (Nutzerwunsch Signatureditor): jeder angemeldete Nutzer darf
// sie LESEN (kein Geheimnis - sie steht sichtbar unter der Nachricht); gepflegt wird sie ueber die
// Mail-Einstellungen (requireMailSettings, siehe routes/mail-settings.js).
const getSignatureStmt = db.prepare('SELECT signature FROM smtp_config WHERE id = 1');
router.get('/signature', (req, res) => {
  const row = getSignatureStmt.get();
  res.json({ signature: row?.signature || '' });
});

// Rechte-Audit 2026-07-17: Versand ueber die Buerokonten braucht jetzt das sendMail-Recht
// (Default an) - bisher konnte jeder eingeloggte Nutzer versenden, auch reine Lese-Zugaenge.
router.post('/', requireSendMail, async (req, res) => {
  const { to, cc, bcc, subject, body, html, extraAttachments, pdfKennwort, pdfKennwortMail } = req.body || {};
  if (!to) return res.status(400).json({ error: 'Empfänger-E-Mail-Adresse erforderlich.' });
  const attachments = [];
  for (const extra of extraAttachments || []) {
    if (!extra || !extra.filename || !extra.dataBase64) continue;
    try {
      attachments.push({ filename: extra.filename, mimeType: extra.mimeType, content: Buffer.from(extra.dataBase64, 'base64') });
    } catch (_e) { /* ungueltige Anlage einfach ueberspringen */ }
  }
  try {
    await schuetzePdfAnlagen(attachments, pdfKennwort);
    await mail.sendDocumentMail({ to, cc, bcc, subject, body, html, attachments }, mail.resolveUserSmtpCfg(req.session.userId, req.session.mode));
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Mail konnte nicht gesendet werden.' });
  }
  let kennwortMailFehler = null;
  if (pdfKennwortMail && String(pdfKennwort || '').trim()) {
    try {
      const inhalt = kennwortMailInhalt(subject, String(pdfKennwort).trim());
      await mail.sendDocumentMail({ to, cc, bcc, subject: inhalt.subject, body: inhalt.body, html: '', attachments: [] }, mail.resolveUserSmtpCfg(req.session.userId, req.session.mode));
    } catch (fehler) {
      kennwortMailFehler = 'Die Dokument-E-Mail wurde gesendet, aber die Kennwort-E-Mail schlug fehl: ' + (fehler.message || fehler);
    }
  }
  res.json(kennwortMailFehler ? { ok: true, kennwortMailFehler } : { ok: true });
});

module.exports = router;
