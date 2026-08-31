'use strict';

// Gemeinsame Verweisschicht fuer Dateianlagen der Fachmodule. Ein Fachobjekt behaelt seine
// Metadaten-Tabelle; der Dateiinhalt liegt genau einmal als normales Dokument im zentralen
// Dokumentenspeicher. Beim Entfernen eines Fachverweises wird die Datei bewusst nicht geloescht.

const path = require('path');

function isoDate(value) {
  const raw = String(value || '').trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(raw);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return new Date().toISOString().slice(0, 10);
}

function datedName(value, date) {
  const raw = String(value || '').trim() || 'Unbenannt';
  if (/^\d{6}(?:\s|$)/.test(raw)) return raw;
  const day = isoDate(date);
  return `${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)} ${raw}`;
}

function createModuleFiles(options) {
  const opt = options || {};
  if (!opt.db) throw new Error('module-files benoetigt eine Datenbank.');
  if (!opt.documents) throw new Error('module-files benoetigt die Dokument-Helfer.');
  const db = opt.db;
  const documents = opt.documents;

  const linkGet = db.prepare(`
    SELECT l.module, l.owner_id, l.slot, l.detail_json, f.*
      FROM doc_links l
      JOIN doc_files f ON f.id = l.file_id
     WHERE l.module = ? AND l.owner_id = ? AND l.slot = ?
  `);
  const linkAnySlotForCase = db.prepare(`
    SELECT l.module, l.owner_id, l.slot, l.detail_json, f.*
      FROM doc_links l
      JOIN doc_files f ON f.id = l.file_id
     WHERE l.module = ? AND l.slot = ?
       AND f.area = 'case' AND f.case_id = ?
     ORDER BY l.created_at LIMIT 1
  `);
  const linkInsert = db.prepare(`
    INSERT INTO doc_links (module, owner_id, slot, file_id, detail_json)
    VALUES (@module, @ownerId, @slot, @fileId, @detailJson)
  `);
  const linkInsertIgnore = db.prepare(`
    INSERT OR IGNORE INTO doc_links (module, owner_id, slot, file_id, detail_json)
    VALUES (@module, @ownerId, @slot, @fileId, @detailJson)
  `);
  const linkDelete = db.prepare('DELETE FROM doc_links WHERE module = ? AND owner_id = ? AND slot = ?');
  const linksForOwnerDelete = db.prepare('DELETE FROM doc_links WHERE module = ? AND owner_id = ?');
  const createdBySet = db.prepare('UPDATE doc_files SET created_by = COALESCE(created_by, ?) WHERE id = ?');
  const importRemember = db.prepare(`
    INSERT OR IGNORE INTO doc_module_import (quelle, quell_id, file_id) VALUES (?, ?, ?)
  `);
  const caseById = db.prepare('SELECT id FROM cases WHERE id = ?');
  const casesByLabel = db.prepare('SELECT id FROM cases WHERE label = ? ORDER BY id');

  function caseIdFor(caseId, caseLabel) {
    const explicit = String(caseId || '').trim();
    // Eine gesendete ID darf nie durch ein gleichnamiges Aktenlabel auf einen
    // anderen Fall "repariert" oder still zur Büroablage herabgestuft werden.
    if (explicit) {
      if (caseById.get(explicit)) return explicit;
      throw new Error('Die angegebene Fall-ID existiert nicht.');
    }
    const label = String(caseLabel || '').trim();
    const rows = label ? casesByLabel.all(label) : [];
    return rows.length === 1 ? String(rows[0].id) : '';
  }

  function target(spec) {
    const date = isoDate(spec.date);
    const year = date.slice(0, 4);
    const month = date.slice(5, 7);
    const caseId = caseIdFor(spec.caseId, spec.caseLabel);
    const module = String(spec.module || '');
    if (Array.isArray(spec.folders) && spec.folders.length) {
      const area = spec.area === 'case' ? 'case' : 'office';
      if (area === 'case' && !caseId) throw new Error('Fallbezug fuer die Dokumentablage fehlt.');
      return { area, caseId: area === 'case' ? caseId : '', folders: spec.folders, date };
    }
    if (module === 'case-document') {
      if (!caseId) throw new Error('Fallbezug fuer den Dokumentenausgang fehlt.');
      return { area: 'case', caseId, folders: ['11 - Betreuungsführung', 'Dokumentenausgang', year, month], date };
    }
    if (module === 'inbox') {
      return caseId
        ? { area: 'case', caseId, folders: ['00 - Eingang'], date }
        : { area: 'office', caseId: '', folders: ['Posteingang', year, month], date };
    }
    if (module === 'finance-statement') {
      return { area: 'office', caseId: '', folders: ['Finanzen', 'Kontoauszüge', year, month], date };
    }
    if (module === 'finance-receipt') {
      return { area: 'office', caseId: '', folders: ['Finanzen', 'Belege', year, month], date };
    }
    if (module === 'office-logo') {
      return { area: 'office', caseId: '', folders: ['Stammdaten'], date };
    }
    if (module === 'todo-attachment' || module === 'calendar-attachment') {
      return caseId
        ? { area: 'case', caseId, folders: ['11 - Betreuungsführung', 'Schriftverkehr', year, month], date }
        : { area: 'office', caseId: '', folders: ['Termine & Aufgaben', year, month], date };
    }
    throw new Error('Unbekannte Modulablage: ' + module);
  }

  function resolve(module, ownerId, slot, allowSharedSlot, caseId) {
    const expectedCaseId = String(caseId || '');
    let exact = linkGet.get(String(module), String(ownerId), String(slot || ''));
    if (exact && expectedCaseId
      && (exact.area !== 'case' || String(exact.case_id || '') !== expectedCaseId)) {
      exact = null;
    }
    /*
     * Geteilte Fotokennungen sind nur innerhalb EINER Fallakte gemeinsam.
     * Ein globaler module+slot-Fallback könnte bei historisch wiederverwendeten
     * Kennungen sonst Dokumente zwischen zwei Fällen ausliefern.
     */
    const shared = allowSharedSlot && expectedCaseId
      ? linkAnySlotForCase.get(String(module), String(slot || ''), expectedCaseId)
      : null;
    const row = exact || shared;
    if (!row || row.deleted_at) return null;
    const filePath = documents.findBlobPath(row);
    return filePath ? { row, filePath } : { row, filePath: null };
  }

  function store(spec) {
    const module = String(spec.module || '');
    const ownerId = String(spec.ownerId || '');
    const slot = String(spec.slot || '');
    if (!module || !ownerId) throw new Error('Modul und Fachobjekt-Kennung sind erforderlich.');
    const existing = linkGet.get(module, ownerId, slot);
    if (existing && !existing.deleted_at) {
      const filePath = documents.findBlobPath(existing);
      if (filePath) return { id: existing.id, name: existing.name, row: existing, filePath, reused: true, adjustments: [] };
      throw new Error('Der vorhandene Modulverweis zeigt auf einen fehlenden Dateiinhalt.');
    }
    const destination = target(spec);
    const folderId = documents.ordnerSicherstellen(destination.area, destination.caseId, destination.folders);
    const fileName = spec.keepName ? String(spec.filename || 'Unbenannt') : datedName(spec.filename, destination.date);
    const placed = documents.dateiAblegen(
      destination.area,
      destination.caseId,
      folderId,
      fileName,
      String(spec.mimeType || 'application/octet-stream'),
      spec.bytes,
      spec.createdBy
    );
    try {
      db.transaction(() => {
        linkInsert.run({
          module,
          ownerId,
          slot,
          fileId: placed.id,
          detailJson: JSON.stringify(spec.detail || {})
        });
        createdBySet.run(spec.createdBy == null ? null : spec.createdBy, placed.id);
        const source = legacyImportKey(spec);
        if (source) importRemember.run(source.quelle, source.quellId, placed.id);
      })();
    } catch (error) {
      // Kein stilles Loeschen bei einem Verknuepfungsfehler: die bereits sicher geschriebene
      // Datei wandert wiederherstellbar in den Papierkorb.
      const row = documents.dateiZeile(placed.id);
      if (row) {
        try { documents.dateiPapierkorb(row, spec.createdBy || null); } catch (_ignore) { /* Abgleich meldet sie */ }
      }
      throw error;
    }
    const row = documents.dateiZeile(placed.id);
    return {
      id: placed.id,
      name: placed.name,
      row,
      filePath: row && documents.findBlobPath(row),
      reused: false,
      adjustments: placed.adjustments || [],
      target: destination
    };
  }

  function legacyImportKey(spec) {
    const module = String(spec.module || '');
    const ownerId = String(spec.ownerId || '');
    const slot = String(spec.slot || '');
    if (module === 'doku-photo') {
      const caseId = String(spec.caseId || (spec.detail && spec.detail.caseId) || '');
      return caseId && slot ? { quelle: 'dokuanlagen', quellId: `${caseId}/${slot}` } : null;
    }
    if (module === 'inbox') return { quelle: 'posteingang', quellId: ownerId };
    if (module === 'finance-receipt') return { quelle: 'belege', quellId: ownerId };
    if (module === 'finance-statement') return { quelle: 'auszuege', quellId: ownerId };
    if (module === 'todo-attachment') return { quelle: 'todo-anlagen', quellId: `${ownerId}/${slot}` };
    if (module === 'calendar-attachment') return { quelle: 'kalender-anlagen', quellId: `${ownerId}/${slot}` };
    if (module === 'office-logo') return { quelle: 'buero-logo', quellId: ownerId };
    if (module === 'case-document') return { quelle: 'falldokumente', quellId: ownerId };
    return null;
  }

  function replace(spec) {
    const found = resolve(spec.module, spec.ownerId, spec.slot, false);
    if (!found) return store(spec);
    if (!found.filePath) throw new Error('Der vorhandene Modulverweis zeigt auf einen fehlenden Dateiinhalt.');
    documents.dateiErsetzen(found.row, String(spec.mimeType || found.row.mime_type || 'application/octet-stream'), spec.bytes);
    let row = documents.dateiZeile(found.row.id);
    const wanted = spec.keepName
      ? String(spec.filename || row.name)
      : datedName(spec.filename || row.name, spec.date);
    if (wanted && wanted !== row.name) {
      documents.dateiVerschieben(row, row.folder_id, wanted);
      row = documents.dateiZeile(row.id);
    }
    return {
      id: row.id,
      name: row.name,
      row,
      filePath: documents.findBlobPath(row),
      reused: true,
      adjustments: []
    };
  }

  function unlink(module, ownerId, slot) {
    return linkDelete.run(String(module), String(ownerId), String(slot || '')).changes;
  }

  function linkExisting(module, ownerId, slot, fileId, detail) {
    const file = documents.dateiZeile(String(fileId || ''));
    if (!file) throw new Error('Zentrale Datei fuer den Verweis wurde nicht gefunden.');
    linkInsertIgnore.run({
      module: String(module),
      ownerId: String(ownerId),
      slot: String(slot || ''),
      fileId: file.id,
      detailJson: JSON.stringify(detail || {})
    });
    return resolve(module, ownerId, slot, false);
  }

  function unlinkOwner(module, ownerId) {
    return linksForOwnerDelete.run(String(module), String(ownerId)).changes;
  }

  function rename(module, ownerId, slot, wantedName) {
    const found = resolve(module, ownerId, slot, false);
    if (!found || !found.filePath) return null;
    const moved = documents.dateiVerschieben(found.row, found.row.folder_id, wantedName);
    return { row: documents.dateiZeile(found.row.id), moved };
  }

  function moveTo(spec) {
    const found = resolve(spec.module, spec.ownerId, spec.slot, !!spec.allowSharedSlot);
    if (!found || !found.filePath) return null;
    const destination = target(spec);
    const folderId = documents.ordnerSicherstellen(destination.area, destination.caseId, destination.folders);
    let sourceName = String(spec.filename || found.row.name);
    if (spec.redate) sourceName = sourceName.replace(/^\d{6}\s+/, '');
    const wantedName = spec.keepName ? sourceName : datedName(sourceName, destination.date);
    const moved = documents.dateiUmhaengen(
      found.row,
      destination.area,
      destination.caseId,
      folderId,
      wantedName
    );
    return { row: documents.dateiZeile(found.row.id), moved, target: destination };
  }

  function legacyPath(parts) {
    return path.join(...parts.map((part) => String(part)));
  }

  return {
    isoDate,
    datedName,
    caseIdFor,
    target,
    resolve,
    store,
    replace,
    linkExisting,
    unlink,
    unlinkOwner,
    rename,
    moveTo,
    legacyPath
  };
}

module.exports = { createModuleFiles, isoDate, datedName };
