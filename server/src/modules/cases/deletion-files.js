'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STAGING_PREFIX = '.ablage-case-delete-';

function exists(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Same-volume renames make a failed SQLite transaction reversible. The journal
// also covers a process restart between the file operations and the commit.
function createDeletionFiles({ db, dataRoot }) {
  const journalRoot = path.join(dataRoot, 'case-deletions');

  function finish(journal, journalPath) {
    const committed = !db.prepare('SELECT 1 FROM cases WHERE id=?').get(journal.caseId);
    if (committed) {
      for (const entry of journal.moves) fs.rmSync(entry.staged, { recursive: true, force: true });
    } else {
      for (const entry of [...journal.moves].reverse()) {
        if (!exists(entry.staged)) continue;
        if (exists(entry.original)) throw new Error('Eine Datei am ursprünglichen Ort verhindert die Wiederherstellung.');
        fs.renameSync(entry.staged, entry.original);
      }
      for (const file of journal.created) fs.rmSync(file, { force: true });
    }
    fs.unlinkSync(journalPath);
  }

  function recover() {
    if (!exists(journalRoot)) return;
    for (const name of fs.readdirSync(journalRoot)) {
      if (!/^[\da-f-]+\.json$/.test(name)) continue;
      const journalPath = path.join(journalRoot, name);
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      finish(journal, journalPath);
    }
  }

  function stage(caseId, files, created, prepare, mutate) {
    recover();
    const operation = crypto.randomUUID();
    const sorted = [...new Set(files)].sort((a, b) => a.length - b.length);
    const selected = [];
    for (const file of sorted) {
      if (!selected.some(parent => file.startsWith(parent + path.sep)) && exists(file)) selected.push(file);
    }
    const journal = {
      caseId,
      moves: selected.map((original, index) => ({ original,
        staged: path.join(path.dirname(original), STAGING_PREFIX + operation + '-' + index) })),
      created
    };
    fs.mkdirSync(journalRoot, { recursive: true, mode: 0o700 });
    const journalPath = path.join(journalRoot, operation + '.json');
    fs.writeFileSync(journalPath, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
    try {
      db.transaction(() => {
        prepare();
        for (const entry of journal.moves) fs.renameSync(entry.original, entry.staged);
        mutate();
      })();
    } catch (error) {
      try { finish(journal, journalPath); }
      catch (restoreError) { throw new Error('Löschen abgebrochen; Wiederherstellung ausstehend: ' + restoreError.message, { cause: error }); }
      throw error;
    }
    try { finish(journal, journalPath); return false; }
    catch (error) {
      console.error('[case.delete] Dateibereinigung wird beim nächsten Start wiederholt:', error.message);
      return true;
    }
  }

  return { recover, stage };
}

module.exports = { createDeletionFiles, STAGING_PREFIX, exists };
