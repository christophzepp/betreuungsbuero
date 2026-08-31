'use strict';

const operationCoordinator = require('./operation-coordinator');
const applicationWriteBarrier = require('../../middleware/application-write-barrier');

let singleton = null;
let timer = null;

function parseTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  if (!match) throw new Error('Uhrzeit muss HH:MM sein.');
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function lastScheduled(plan, now) {
  const time = parseTime(plan.time_hhmm);
  const candidate = new Date(now);
  candidate.setHours(time.hour, time.minute, 0, 0);
  if (candidate > now) candidate.setDate(candidate.getDate() - 1);
  if (plan.schedule_type === 'weekly') {
    const allowed = String(plan.weekdays || '0').split(',')
      .map(Number).filter((value) => value >= 0 && value <= 6);
    const weekdays = allowed.length ? allowed : [0];
    while (!weekdays.includes(candidate.getDay())) candidate.setDate(candidate.getDate() - 1);
  }
  return candidate;
}

function publicPlan(row) {
  let result = {};
  try { result = JSON.parse(row.last_result_json || '{}'); } catch (_error) { result = {}; }
  return {
    id: row.id,
    label: row.label,
    enabled: !!row.enabled,
    scheduleType: row.schedule_type,
    weekdays: String(row.weekdays || '').split(',').filter(Boolean).map(Number),
    timeHhmm: row.time_hhmm,
    verification: row.verification,
    applyMode: row.apply_mode,
    autoDelete: !!row.auto_delete,
    lastStartedAt: row.last_started_at,
    lastFinishedAt: row.last_finished_at,
    lastStatus: row.last_status,
    lastResult: result
  };
}

function createDocumentMaintenance(options) {
  const opt = options || {};
  const db = opt.db;
  const documents = opt.documents;
  if (!db || !documents || typeof documents.runDocumentIntegrity !== 'function') {
    throw new Error('Wartungsplaner benötigt Datenbank und Integritätsdienst.');
  }
  let running = false;
  let queued = false;
  const get = db.prepare('SELECT * FROM doc_maintenance_plans WHERE id=?');
  const all = db.prepare('SELECT * FROM doc_maintenance_plans ORDER BY time_hhmm,id');
  const updateStmt = db.prepare(`
    UPDATE doc_maintenance_plans SET
      label=@label,enabled=@enabled,schedule_type=@scheduleType,weekdays=@weekdays,
      time_hhmm=@timeHhmm,verification=@verification,apply_mode=@applyMode,
      auto_delete=@autoDelete,updated_at=datetime('now')
    WHERE id=@id
  `);
  const beginStmt = db.prepare(`
    UPDATE doc_maintenance_plans
       SET last_started_at=?,last_status='running',last_result_json='{}'
     WHERE id=?
  `);
  const finishStmt = db.prepare(`
    UPDATE doc_maintenance_plans
       SET last_finished_at=?,last_status=?,last_result_json=?
     WHERE id=?
  `);

  function list() {
    return { running: running || queued, plans: all.all().map(publicPlan) };
  }

  function update(id, body) {
    const row = get.get(String(id || ''));
    if (!row) throw new Error('Wartungsplan nicht gefunden.');
    const scheduleType = body.scheduleType || row.schedule_type;
    if (!['daily', 'weekly'].includes(scheduleType)) throw new Error('Intervall muss täglich oder wöchentlich sein.');
    const verification = body.verification || row.verification;
    if (!['quick', 'full'].includes(verification)) throw new Error('Prüfung muss schnell oder vollständig sein.');
    const applyMode = body.applyMode || row.apply_mode;
    if (!['confirm', 'automatic'].includes(applyMode)) throw new Error('Übernahmemodus ist ungültig.');
    const timeHhmm = body.timeHhmm || row.time_hhmm;
    parseTime(timeHhmm);
    const weekdays = Array.isArray(body.weekdays)
      ? [...new Set(body.weekdays.map(Number).filter((value) => value >= 0 && value <= 6))].join(',')
      : row.weekdays;
    updateStmt.run({
      id: row.id,
      label: body.label === undefined ? row.label : String(body.label || '').slice(0, 120),
      enabled: body.enabled === undefined ? row.enabled : (body.enabled ? 1 : 0),
      scheduleType,
      weekdays,
      timeHhmm,
      verification,
      applyMode,
      autoDelete: body.autoDelete === undefined ? row.auto_delete : (body.autoDelete ? 1 : 0)
    });
    return publicPlan(get.get(row.id));
  }

  function finderFindings(result) {
    return result && result.finder && result.finder.scan && Array.isArray(result.finder.scan.findings)
      ? result.finder.scan.findings
      : [];
  }

  function acceptDeletes(result) {
    const candidates = finderFindings(result)
      .filter((finding) => finding.kind === 'missing_file')
      .map((finding) => String((finding.detail && finding.detail.fileId) || ''))
      .filter(Boolean);
    const changed = [];
    const statement = db.prepare(`
      UPDATE doc_files
         SET deleted_at=datetime('now'),deleted_from=folder_id,folder_id='',
             storage_status='finder-deleted',updated_at=datetime('now')
       WHERE id=? AND deleted_at='' AND managed=0
    `);
    db.transaction(() => {
      for (const id of [...new Set(candidates)]) {
        if (statement.run(id).changes) changed.push(id);
      }
    })();
    return changed;
  }

  async function runCore(id) {
    const row = get.get(String(id || ''));
    if (!row) throw new Error('Wartungsplan nicht gefunden.');
    if (running) throw new Error('Ein Plattenabgleich läuft bereits.');
    running = true;
    beginStmt.run(new Date().toISOString(), row.id);
    try {
      const mode = row.apply_mode === 'automatic' ? 'apply' : 'read';
      const result = await documents.runDocumentIntegrity(mode, row.verification);
      const acceptedDeletes = row.auto_delete && row.apply_mode === 'automatic'
        ? acceptDeletes(result)
        : [];
      const finalResult = {
        ...result,
        planId: row.id,
        acceptedFinderDeletes: acceptedDeletes,
        finderDeletesRequireConfirmation: !row.auto_delete
      };
      finishStmt.run(new Date().toISOString(), result.ok ? 'ok' : 'findings', JSON.stringify(finalResult), row.id);
      return finalResult;
    } catch (error) {
      finishStmt.run(
        new Date().toISOString(),
        'error',
        JSON.stringify({ error: String(error && error.message || error) }),
        row.id
      );
      throw error;
    } finally {
      running = false;
    }
  }

  async function run(id) {
    if (running || queued) throw new Error('Ein Plattenabgleich läuft bereits oder wartet auf die Sicherung.');
    queued = true;
    try {
      const name = `Plattenabgleich ${String(id || '')}`;
      const guarded = await applicationWriteBarrier.withWrite(
        name,
        () => operationCoordinator.runExclusive(
          name,
          () => runCore(id),
          { priority: 15 }
        )
      );
      if (guarded.skipped) {
        return {
          skipped: true,
          reason: guarded.code || 'backup_write_barrier'
        };
      }
      return guarded.value;
    } finally {
      queued = false;
    }
  }

  async function tick(nowValue) {
    if (running || queued) return null;
    const now = nowValue instanceof Date ? nowValue : new Date();
    for (const row of all.all()) {
      if (!row.enabled) continue;
      const due = lastScheduled(row, now);
      const last = row.last_finished_at ? new Date(row.last_finished_at.replace(' ', 'T') + (row.last_finished_at.includes('T') ? '' : 'Z')) : null;
      if (!last || Number.isNaN(last.getTime()) || last < due) return run(row.id);
    }
    return null;
  }

  return { list, run, tick, update, _test: { lastScheduled } };
}

function start(options) {
  if (singleton) return singleton;
  singleton = createDocumentMaintenance(options);
  setImmediate(() => { singleton.tick().catch(() => { /* Status steht am Plan */ }); });
  if (!(options && options.ohneTakt)) {
    timer = setInterval(() => singleton.tick().catch(() => { /* nächster Takt */ }), 60000);
    if (timer.unref) timer.unref();
  }
  return singleton;
}

function current() {
  return singleton;
}

module.exports = { createDocumentMaintenance, current, start, _test: { lastScheduled, parseTime } };
