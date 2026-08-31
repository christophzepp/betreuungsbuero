// AES-256-GCM Ver-/Entschluesselung fuer buerobezogene Zugangsdaten (office_ai_config,
// office_send_credentials), damit diese nie im Klartext in der .sqlite3-Datei liegen.
// Schluessel kommt ausschliesslich aus der Umgebungsvariable ENCRYPTION_KEY (64 Hex-Zeichen
// = 32 Byte). Erzeugen z.B. mit:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const crypto = require('crypto');

function loadKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY fehlt oder hat nicht die erwartete Laenge (64 Hex-Zeichen / 32 Byte). ' +
      'Siehe .env.example.'
    );
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plainText) {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText || ''), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv (12) + authTag (16) + ciphertext, alles hex-kodiert und mit ':' getrennt gespeichert.
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptStrict(stored) {
  if (!stored) return '';
  const parts = String(stored).split(':');
  if (parts.length !== 3) throw new Error('Ungültiges internes Geheimnisformat.');
  const key = loadKey();
  const [ivHex, authTagHex, dataHex] = parts;
  if (!/^[0-9a-f]{24}$/i.test(ivHex)
      || !/^[0-9a-f]{32}$/i.test(authTagHex)
      || !/^(?:[0-9a-f]{2})*$/i.test(dataHex)) {
    throw new Error('Ungültiges internes Geheimnisformat.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

function decrypt(stored) {
  if (!stored) return '';
  if (String(stored).split(':').length !== 3) return '';
  return decryptStrict(stored);
}

module.exports = { encrypt, decrypt, decryptStrict };
