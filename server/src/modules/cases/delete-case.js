'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { inside, joinRoot } = require('../documents/storage');
const { createDeletionFiles, exists } = require('./deletion-files');

const OPTION_KEYS = ['calendar', 'tasks', 'deadlines', 'followups'];
function deletionOptions(body) {
  const options = body && body.deleteRelated;
  if (!options || OPTION_KEYS.some(key => typeof options[key] !== 'boolean')) {
    const error = new Error('Bitte auswählen, ob Termine, Aufgaben, Fristen und Wiedervorlagen mitgelöscht werden sollen.');
    error.status = 400;
    throw error;
  }
  return Object.fromEntries(OPTION_KEYS.map(key => [key, options[key]]));
}

function todoCategory(row) {
  if (row.item_type === 'deadline') return 'deadlines';
  if (row.item_type === 'followup') return 'followups';
  if (row.item_type === 'task') return 'tasks';
  if (/^\s*wiedervorlage\s*:/i.test(row.title) || /\[wiedervorlage\]/i.test(row.description)) return 'followups';
  return /^\s*frist\s*:/i.test(row.title) ? 'deadlines' : 'tasks';
}

function createCaseDeletion({ db, dataRoot, storage }) {
  const fileChanges = createDeletionFiles({ db, dataRoot });

  function safePath(root, candidate) {
    const base = path.resolve(root);
    const target = path.resolve(candidate);
    if (target === base || !inside(base, target)) throw new Error('Unsicherer Dateipfad; der Fall wurde nicht gelöscht.');
    let current = base;
    for (const part of ['', ...path.relative(base, target).split(path.sep)]) {
      current = path.join(current, part);
      const stat = exists(current);
      if (!stat) break;
      if (stat.isSymbolicLink()) throw new Error('Eine symbolische Verknüpfung verhindert das sichere Löschen.');
    }
    return target;
  }

  function remove(row, options) {
    const id = row.id;
    const byCase = table => db.prepare(`SELECT * FROM ${table} WHERE case_id=?`).all(id);
    const events = byCase('calendar_events');
    const todos = byCase('todos');
    const removedEvents = options.calendar ? events : [];
    const keptEvents = options.calendar ? [] : events;
    const removedTodos = todos.filter(todo => options[todoCategory(todo)]);
    const keptTodos = todos.filter(todo => !options[todoCategory(todo)]);
    const files = byCase('doc_files');
    const fileIds = new Set(files.map(file => file.id));
    const preserved = new Set();
    const deletedOwners = new Map([
      ['case-document', new Set(byCase('case_documents').map(item => item.id))],
      ['doku-photo', new Set(byCase('case_doku_entries').map(item => item.id))],
      ['inbox', new Set(byCase('inbox_documents').map(item => item.id))],
      ['calendar-attachment', new Set(removedEvents.map(item => item.id))],
      ['todo-attachment', new Set(removedTodos.map(item => item.id))]
    ]);
    // Shared attachments and documents referenced by retained follow-ups remain
    // usable in the office document area, including their version history.
    for (const link of db.prepare('SELECT l.* FROM doc_links l JOIN doc_files f ON f.id=l.file_id WHERE f.case_id=?').all(id)) {
      if (!deletedOwners.get(link.module)?.has(link.owner_id)) preserved.add(link.file_id);
    }
    for (const todo of keptTodos) {
      if (todo.source_type === 'document' && fileIds.has(todo.source_id)) preserved.add(todo.source_id);
    }
    const removals = new Set();
    const copies = [];
    const created = [];
    const add = (root, file) => removals.add(safePath(root, file));
    const addFile = (root, file) => {
      const target = safePath(root, file);
      const stat = exists(target);
      if (stat && !stat.isFile()) throw new Error('Ein Dateiverweis zeigt auf einen Ordner oder eine besondere Datei. Der Fall wurde nicht gelöscht.');
      removals.add(target);
    };
    const addLegacy = (directory, key) => add(path.join(dataRoot, directory), path.join(dataRoot, directory, key));
    const root = storage.root();
    const storedRoot = db.prepare('SELECT storage_relpath FROM doc_case_roots WHERE case_id=?').get(id);
    const roots = new Set([storage.caseRootInfo(id, false).storageRelpath, storedRoot?.storage_relpath].filter(Boolean));
    for (const relative of roots) {
      if (!/^Fallakten\/[^/]+\/[^/]+$|^Fallakten-Archiv\/[^/]+$/.test(relative)) throw new Error('Die Fallablage ist nicht eindeutig zugeordnet.');
      const candidate = safePath(root, joinRoot(root, relative));
      for (const other of db.prepare('SELECT storage_relpath FROM doc_case_roots WHERE case_id<>?').all(id)) {
        if (other.storage_relpath && inside(candidate, joinRoot(root, other.storage_relpath))) throw new Error('Die Fallablage wird von einem weiteren Fall verwendet.');
      }
      for (const other of db.prepare("SELECT storage_relpath FROM doc_files WHERE case_id<>? AND storage_relpath<>''").all(id)) {
        if (inside(candidate, joinRoot(root, other.storage_relpath))) throw new Error('Die Fallablage enthält Dateien eines anderen Bereichs.');
      }
      removals.add(candidate);
    }
    addLegacy('case-documents', id);
    addLegacy('case-doku-photos', id);
    for (const item of removedEvents) addLegacy('calendar-event-attachments', item.id);
    for (const item of removedTodos) addLegacy('todo-attachments', item.id);
    for (const item of byCase('inbox_documents')) addFile(path.join(dataRoot, 'inbox-documents'), path.join(dataRoot, 'inbox-documents', item.id));

    function filePaths(file, keep, version) {
      let primary = null;
      if (file.storage_relpath) {
        const direct = safePath(root, joinRoot(root, file.storage_relpath));
        if (db.prepare('SELECT 1 FROM doc_files WHERE case_id<>? AND storage_relpath=?').get(id, file.storage_relpath)) {
          throw new Error('Eine Datei wird von einem anderen Bereich verwendet.');
        }
        addFile(root, direct);
        addFile(root, storage.sidecarPath(direct, file.id));
        // Early versions used the parent file ID for the version sidecar.
        if (version && file.file_id) addFile(root, storage.sidecarPath(direct, file.file_id));
        if (exists(direct)?.isFile()) primary = direct;
      }
      // Remove every legacy copy, not just the first readable match.
      for (const legacyRoot of storage.legacyRoots(file)) {
        const plain = safePath(legacyRoot, path.join(legacyRoot, file.id));
        addFile(legacyRoot, plain);
        const escaped = String(file.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!exists(legacyRoot)) continue;
        for (const name of fs.readdirSync(legacyRoot)) {
          if (name === file.id || new RegExp(`^${escaped}(?:-[A-Fa-f0-9]{4,})?\\.[^.\\/]+$`).test(name)) {
            const candidate = safePath(legacyRoot, path.join(legacyRoot, name));
            addFile(legacyRoot, candidate);
            addFile(legacyRoot, storage.sidecarPath(candidate, file.id));
            if (!primary && exists(candidate)?.isFile()) primary = candidate;
          }
        }
      }
      if (!keep) return;
      if (!primary) throw new Error('Eine zu behaltende Anlage fehlt im Dateispeicher. Der Fall wurde nicht gelöscht.');
      const target = storage.targetFor('office', '', '', `${file.id} ${file.name || 'Anlage'}`);
      safePath(root, target.filePath);
      if (exists(storage.sidecarPath(target.filePath, file.id))) throw new Error('Die Zielablage einer zu behaltenden Anlage ist bereits belegt.');
      created.push(target.filePath, storage.sidecarPath(target.filePath, file.id));
      copies.push({ file, primary, target, version });
    }
    for (const file of files) {
      filePaths(file, preserved.has(file.id), false);
      for (const version of db.prepare('SELECT * FROM doc_versions WHERE file_id=?').all(file.id)) {
        filePaths({ ...version, area: file.area, case_id: id }, preserved.has(file.id), true);
      }
    }

    const cleanupPending = fileChanges.stage(id, removals, created, () => {
      for (const copy of copies) {
        fs.copyFileSync(copy.primary, copy.target.filePath, fs.constants.COPYFILE_EXCL);
        storage.writeSidecar({ ...copy.file, area: 'office', case_id: '', folder_id: '', name: copy.target.name }, copy.target.filePath);
      }
    }, () => {
      for (const copy of copies) {
        if (copy.version) {
          db.prepare('UPDATE doc_versions SET storage_relpath=? WHERE id=?').run(copy.target.storageRelpath, copy.file.id);
        } else {
          const stat = fs.statSync(copy.target.filePath);
          db.prepare(`UPDATE doc_files SET area='office',case_id='',folder_id='',name=?,name_key=?,storage_relpath=?,
            storage_dev=?,storage_ino=?,updated_at=datetime('now') WHERE id=?`).run(
            copy.target.name, require('../documents/names').vergleichsschluessel(copy.target.name), copy.target.storageRelpath,
            String(stat.dev), String(stat.ino), copy.file.id);
        }
      }
      for (const [module, owners] of deletedOwners) {
        for (const owner of owners) db.prepare('DELETE FROM doc_links WHERE module=? AND owner_id=?').run(module, owner);
      }
      for (const file of files.filter(item => !preserved.has(item.id))) {
        for (const table of ['doc_links', 'doc_annotations', 'doc_text', 'doc_versions', 'doc_materializations',
          'doc_import_state', 'doc_pair_state', 'doc_module_import', 'doc_integrity_findings', 'doc_migration_items']) {
          db.prepare(`DELETE FROM ${table} WHERE file_id=?`).run(file.id);
        }
        db.prepare('DELETE FROM doc_files WHERE id=?').run(file.id);
      }
      // Remove jobs targeting this case so a later import cannot recreate it.
      for (const table of ['doc_import_jobs', 'doc_pair_jobs', 'doc_backup_jobs']) {
        for (const job of db.prepare(`SELECT * FROM ${table}`).all()) {
          const referencesCase = value => {
            const parsed = JSON.parse(value || '{}');
            return parsed.caseId === id || parsed.case_id === id;
          };
          if (!referencesCase(job.target_json) && !referencesCase(job.source_json)) continue;
          if (table === 'doc_import_jobs') db.prepare('DELETE FROM doc_import_state WHERE job_id=?').run(job.id);
          if (table === 'doc_pair_jobs') db.prepare('DELETE FROM doc_pair_state WHERE pair_id=?').run(job.id);
          db.prepare(`DELETE FROM ${table} WHERE id=?`).run(job.id);
        }
      }
      for (const item of removedEvents) {
        db.prepare('DELETE FROM calendar_event_attachments WHERE event_id=?').run(item.id);
        db.prepare('DELETE FROM calendar_events WHERE id=?').run(item.id);
      }
      for (const item of removedTodos) {
        db.prepare('DELETE FROM todo_attachments WHERE todo_id=?').run(item.id);
        db.prepare('DELETE FROM todos WHERE id=?').run(item.id);
      }
      for (const fileId of preserved) {
        if (!keptTodos.some(item => item.source_type === 'document' && item.source_id === fileId && !item.done)) {
          db.prepare("UPDATE doc_files SET resubmit_at='',resubmit_note='' WHERE id=?").run(fileId);
        }
      }
      const historicalDescription = item => [item.description, `Ehemaliger Fall: ${row.label}`].filter(Boolean).join('\n\n');
      for (const item of keptEvents) {
        db.prepare("UPDATE calendar_events SET case_id='',case_label='',description=?,updated_at=datetime('now') WHERE id=?")
          .run(historicalDescription(item), item.id);
      }
      for (const item of keptTodos) {
        const keepSource = item.source_type === 'document' && preserved.has(item.source_id);
        db.prepare(`UPDATE todos SET case_id='',case_label='',description=?,source_type=?,source_id=?,source_module='',source_ref='',
          updated_at=datetime('now') WHERE id=?`).run(historicalDescription(item), keepSource ? 'document' : '', keepSource ? item.source_id : '', item.id);
      }
      // The main deadline register lives in the case JSON, independently of its
      // optional calendar/reminder copies. Keep list-only deadlines as first-class
      // standalone deadline tasks, with every original field available for display.
      if (!options.deadlines) {
        const data = JSON.parse(row.stammdaten_json || '{}');
        for (const deadline of Array.isArray(data.fristen) ? data.fristen : []) {
          if (!deadline || typeof deadline !== 'object') continue;
          const existing = keptTodos.find(item => item.id === deadline.todoId && todoCategory(item) === 'deadlines');
          const repetition = { weekly: ['weekly', 1], biweekly: ['weekly', 2], monthly: ['monthly', 1],
            quarterly: ['monthly', 3], halfyear: ['monthly', 6], yearly: ['yearly', 1] }[deadline.interval];
          const recurrence = repetition ? JSON.stringify({ freq: repetition[0], interval: repetition[1], until: '' }) : '';
          const value = { ...deadline, calEventId: '', todoId: '', routing: 'none', source: 'manual', linkSyncError: '', pendingCompletion: false };
          const reference = JSON.stringify({ deadline: value, formerCaseLabel: row.label });
          if (existing) {
            db.prepare("UPDATE todos SET source_type='retained-deadline',source_module='case-deletion',source_ref=? WHERE id=?").run(reference, existing.id);
          } else {
            db.prepare(`INSERT INTO todos (id,title,description,due_at,done,priority,item_type,source_type,source_module,source_ref,recurrence_rule)
              VALUES (?,?,?,?,?,?,'deadline','retained-deadline','case-deletion',?,?)`).run(
              crypto.randomUUID(), deadline.title || deadline.formName || 'Frist',
              [deadline.note, `Ehemaliger Fall: ${row.label}`].filter(Boolean).join('\n\n'), deadline.dueDate || '',
              deadline.status === 'erledigt' ? 1 : 0, deadline.priority === 'high' ? 'high' : 'normal', reference, recurrence);
          }
        }
      }
      for (const table of ['case_reports', 'case_doku_entries', 'case_contacts', 'case_documents', 'case_access',
        'betreuung_overview_entries', 'bank_payment_orders', 'bank_recurring_payments', 'inbox_documents',
        'mcp_proposals', 'mcp_log', 'addressbook_merges', 'addressbook_case_favorites', 'addressbook_preferences',
        'addressbook_sync_bindings', 'addressbook_trash', 'addressbook_history', 'doc_activity', 'doc_folders',
        'doc_case_roots', 'connection_case_projects']) {
        db.prepare(`DELETE FROM ${table} WHERE case_id=?`).run(id);
      }
      db.prepare("DELETE FROM doc_materializations WHERE scope_type='case' AND scope_id=?").run(id);
      // Old dedicated case connections are case data. Shared gateways and
      // connections with accounts assigned elsewhere keep their other users.
      for (const connection of byCase('bank_connections')) {
        const shared = db.prepare('SELECT 1 FROM bank_accounts_discovered WHERE connection_id=? AND manual_case_id IS NOT NULL AND manual_case_id<>?').get(connection.id, id);
        if (connection.scope !== 'case' || shared) continue;
        db.prepare('DELETE FROM bank_transactions WHERE connection_id=?').run(connection.id);
        db.prepare('DELETE FROM bank_accounts_discovered WHERE connection_id=?').run(connection.id);
        db.prepare('DELETE FROM bank_connections WHERE id=?').run(connection.id);
      }
      db.prepare('UPDATE bank_connections SET case_id=NULL WHERE case_id=?').run(id);
      db.prepare("UPDATE bank_accounts_discovered SET manual_case_id=NULL,case_assignment_mode='manual' WHERE manual_case_id=?").run(id);
      // Office invoices and audit history remain office records, without a live case link.
      db.prepare("UPDATE outgoing_invoices SET case_id='',case_label='',report_id='' WHERE case_id=?").run(id);
      cleanOfficeData(row);
      db.prepare('DELETE FROM cases WHERE id=?').run(id);
    });
    return { cleanupPending, removedEvents, removedTodos, keptEvents: keptEvents.length, keptTodos: keptTodos.length };
  }

  function cleanOfficeData(caseRow) {
    const caseId = caseRow.id;
    for (const key of ['case_intakes', 'case_outtakes', 'kontaktmonitor']) {
      const row = db.prepare('SELECT data_json FROM office_json WHERE key=?').get(key);
      if (!row) continue;
      const value = JSON.parse(row.data_json);
      if (!Array.isArray(value.entries)) continue;
      value.entries = value.entries.filter(entry => {
        const assigned = entry.caseId || entry.state?.targetCaseId || entry.state?.caseId;
        if (assigned !== caseId) return true;
        if (key === 'case_intakes') {
          db.prepare('DELETE FROM intake_files WHERE draft_id=?').run(entry.id || entry.draftId || '');
          db.prepare('DELETE FROM case_intake_ocr WHERE draft_id=?').run(entry.id || entry.draftId || '');
        }
        return false;
      });
      db.prepare("UPDATE office_json SET data_json=?,updated_at=datetime('now') WHERE key=?").run(JSON.stringify(value), key);
    }
    for (const key of ['mailx_case_links', 'aussendienst_ledger', 'ai_chats']) {
      const stored = db.prepare('SELECT data_json FROM office_json WHERE key=?').get(key);
      if (!stored) continue;
      const value = JSON.parse(stored.data_json);
      const removeLinks = links => {
        if (!links || typeof links !== 'object') return;
        for (const [key, entry] of Object.entries(links)) if (entry?.caseId === caseId) delete links[key];
      };
      if (key === 'mailx_case_links') removeLinks(value);
      if (key === 'aussendienst_ledger') for (const bucket of ['applied', 'rejected', 'proposed']) removeLinks(value[bucket]);
      if (key === 'ai_chats' && Array.isArray(value.chats)) {
        // Older chats only contain a display name. Never guess when two cases
        // share a name; explicit case IDs always take precedence.
        const labels = row => {
          let person = {}; try { person = JSON.parse(row.stammdaten_json || '{}').person || {}; } catch (_error) { /* legacy */ }
          return [row.label, [person.firstName, person.lastName].filter(Boolean).join(' ')].filter(Boolean);
        };
        const foreign = new Set(db.prepare('SELECT label,stammdaten_json FROM cases WHERE id<>?').all(caseId).flatMap(labels));
        const unique = new Set(labels(caseRow).filter(label => !foreign.has(label)));
        value.chats = value.chats.filter(entry => entry?.caseId ? entry.caseId !== caseId : !unique.has(entry?.caseLabel));
      }
      db.prepare("UPDATE office_json SET data_json=?,updated_at=datetime('now') WHERE key=?").run(JSON.stringify(value), key);
    }
    const config = db.prepare("SELECT data_json FROM office_json WHERE key='documents_config'").get();
    if (config) {
      const value = JSON.parse(config.data_json);
      if (value.caseDirs) delete value.caseDirs[caseId];
      db.prepare("UPDATE office_json SET data_json=? WHERE key='documents_config'").run(JSON.stringify(value));
    }
  }

  return { remove, recover: fileChanges.recover };
}

module.exports = { createCaseDeletion, deletionOptions, todoCategory };
