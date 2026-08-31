// Sync-Journal (Plan PLAN-AUFGABEN-SYNC, Abschnitt C.5): jede Entscheidung des Abgleichs, die
// Daten verwirft, repariert oder von aussen ablehnt, wird hier nachvollziehbar festgehalten.
// Bewusst schlank: eine Zeile je Ereignis, aeltere Eintraege werden beim Schreiben abgeraeumt
// (Deckel), damit das Journal nie zur zweiten Datenbank wird. Nicht Teil der portablen
// Sicherungen (wie audit_log) - es beschreibt Ablaeufe, keine Fachdaten.

const crypto = require('crypto');
const db = require('../../database/index');

const insertStmt = db.prepare(`
  INSERT INTO sync_journal (id, connection_id, direction, action, local_type, local_id, remote_id, detail)
  VALUES (@id, @connectionId, @direction, @action, @localType, @localId, @remoteId, @detail)
`);
const trimStmt = db.prepare(`
  DELETE FROM sync_journal WHERE id IN (
    SELECT id FROM sync_journal ORDER BY ts DESC, id DESC LIMIT -1 OFFSET 2000
  )
`);
const listStmt = db.prepare('SELECT * FROM sync_journal ORDER BY ts DESC, id DESC LIMIT ?');

function write(entry) {
  try {
    insertStmt.run({
      id: crypto.randomUUID(),
      connectionId: entry.connectionId || null,
      direction: String(entry.direction || ''),
      action: String(entry.action || ''),
      localType: String(entry.localType || ''),
      localId: String(entry.localId || ''),
      remoteId: String(entry.remoteId || ''),
      detail: String(entry.detail || '').slice(0, 600)
    });
    trimStmt.run();
  } catch (error) {
    // Das Journal darf nie den Abgleich selbst zu Fall bringen.
    console.warn('[sync-journal]', error.message);
  }
}

function list(limit) {
  const n = Math.max(1, Math.min(500, Number(limit) || 100));
  return listStmt.all(n);
}

module.exports = { write, list };
