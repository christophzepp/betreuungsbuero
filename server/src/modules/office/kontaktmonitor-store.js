'use strict';

const { isDeepStrictEqual } = require('node:util');
const db = require('../../database/index');
const { sichtbareFaelle, darfSehen, darfBearbeiten } = require('../cases/case-visibility');
const { isDemoCaseId } = require('../demo/data-identities');
const caseExists = db.prepare('SELECT 1 FROM live_cases WHERE id=?');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const caseId = entry => String(entry.caseId);
const entryId = entry => entry.id == null ? '' : String(entry.id);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

function validate(data, status, requireEntries) {
  if (!object(data) || (requireEntries && !Array.isArray(data.entries))
      || (data.entries !== undefined && !Array.isArray(data.entries))) {
    fail(status, 'Der Kontaktmonitor benötigt ein Objekt mit einer Eintragsliste. Vorhandene Daten bleiben erhalten.');
  }
  const cases = new Set(), ids = new Set();
  for (const entry of data.entries || []) {
    if (!object(entry) || !['string', 'number'].includes(typeof entry.caseId) || !String(entry.caseId).trim()
        || (entry.id != null && !['string', 'number'].includes(typeof entry.id))) {
      fail(status, 'Ein Kontaktmonitor-Eintrag hat keine eindeutige Fallzuordnung.');
    }
    const key = caseId(entry), id = entryId(entry);
    if (cases.has(key) || (id && ids.has(id))) fail(status, 'Kontaktmonitor-Kennungen sind mehrfach vorhanden.');
    cases.add(key); if (id) ids.add(id);
  }
  return data;
}

function read(raw) {
  let data;
  try { data = raw == null ? {} : JSON.parse(raw); }
  catch (_error) { fail(409, 'Der gespeicherte Kontaktmonitor ist nicht lesbar. Vorhandene Daten bleiben erhalten.'); }
  return validate(data, 409, false);
}

function visible(data, session) {
  const allowed = sichtbareFaelle(session);
  return { ...data, entries: (data.entries || []).filter(entry =>
    !isDemoCaseId(caseId(entry)) && (allowed === null || allowed.has(caseId(entry)))) };
}

function merge(incoming, existing, session) {
  validate(incoming, 400, true);
  validate(existing, 409, false);
  const previous = existing.entries || [];
  const oldByCase = new Map(previous.map(entry => [caseId(entry), entry]));
  const oldById = new Map(previous.filter(entry => entryId(entry)).map(entry => [entryId(entry), entry]));
  const canWrite = key => !!caseExists.get(key) && darfBearbeiten(session, key);
  const denied = () => fail(403, 'Keine Berechtigung, diesen Kontaktmonitor-Eintrag zu ändern.');
  for (const entry of incoming.entries) {
    const key = caseId(entry), old = oldByCase.get(key), identified = oldById.get(entryId(entry));
    if (identified && caseId(identified) !== key && !canWrite(caseId(identified))) denied();
    if (!canWrite(key) && (!old || !darfSehen(session, key) || !isDeepStrictEqual(old, entry))) denied();
  }
  const pending = new Map(incoming.entries.map(entry => [caseId(entry), entry]));
  const entries = [];
  for (const old of previous) {
    const key = caseId(old);
    if (!canWrite(key)) entries.push(old);
    else if (pending.has(key)) entries.push(pending.get(key));
    pending.delete(key);
  }
  entries.push(...pending.values());
  return { ...existing, ...incoming, entries };
}

module.exports = { read, visible, merge };
