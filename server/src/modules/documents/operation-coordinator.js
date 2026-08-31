'use strict';

/*
 * Gemeinsame serielle Schranke für Arbeiten, die den Dokumentenbaum vollständig
 * lesen oder verwaltete Dateien austauschen. Normale Dokumentzugriffe bleiben
 * parallel; Vollsicherung, Materialisierung, Plattenabgleich und Integritätslauf
 * erhalten dagegen einen eindeutigen Ausführungszeitraum.
 *
 * Verschachtelte Aufrufe innerhalb derselben Operation sind reentrant. Dadurch
 * darf eine Vollsicherung ihre Materialisierungen unmittelbar aktualisieren,
 * ohne sich hinter der eigenen Sperre einzureihen.
 */

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const context = new AsyncLocalStorage();
let active = null;
let sequence = 0;
const queue = [];

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    name: job.name,
    priority: job.priority,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt || '',
    deadlineExceeded: !!job.deadlineExceeded
  };
}

function status() {
  return {
    active: publicJob(active),
    waiting: queue.map(publicJob)
  };
}

function sortQueue() {
  queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
}

function drain() {
  if (active || !queue.length) return;
  const job = queue.shift();
  active = job;
  job.startedAt = new Date().toISOString();
  const controller = new AbortController();
  let deadlineTimer = null;
  if (job.timeoutMs > 0) {
    deadlineTimer = setTimeout(() => {
      job.deadlineExceeded = true;
      controller.abort(new Error(`Zeitgrenze der Operation „${job.name}“ überschritten.`));
      if (job.onDeadline) {
        try { job.onDeadline(publicJob(job)); } catch (_error) { /* Diagnose darf Lauf nicht stören */ }
      }
    }, job.timeoutMs);
    if (deadlineTimer.unref) deadlineTimer.unref();
  }
  const token = { coordinator: module.exports, operationId: job.id };
  Promise.resolve()
    .then(() => context.run(token, () => job.fn({
      id: job.id,
      name: job.name,
      signal: controller.signal,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt
    })))
    .then(job.resolve, job.reject)
    .finally(() => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      active = null;
      drain();
    });
}

function runExclusive(name, fn, options) {
  if (typeof fn !== 'function') return Promise.reject(new TypeError('Eine Operation braucht eine Funktion.'));
  const inherited = context.getStore();
  if (inherited && inherited.coordinator === module.exports) {
    return Promise.resolve().then(() => fn({
      id: inherited.operationId,
      name: String(name || 'verschachtelt'),
      signal: new AbortController().signal,
      nested: true
    }));
  }
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.skipIfBusy && (active || queue.length)) {
    return Promise.resolve({
      skipped: true,
      reason: 'busy',
      active: publicJob(active)
    });
  }
  return new Promise((resolve, reject) => {
    queue.push({
      id: crypto.randomUUID(),
      name: String(name || 'Dokumentenoperation').slice(0, 100),
      fn,
      resolve,
      reject,
      priority: Number.isFinite(Number(opts.priority)) ? Number(opts.priority) : 0,
      timeoutMs: Number.isFinite(Number(opts.timeoutMs)) ? Math.max(0, Number(opts.timeoutMs)) : 0,
      onDeadline: typeof opts.onDeadline === 'function' ? opts.onDeadline : null,
      sequence: sequence++,
      queuedAt: new Date().toISOString(),
      startedAt: '',
      deadlineExceeded: false
    });
    sortQueue();
    drain();
  });
}

function resetForTests() {
  if (active || queue.length) throw new Error('Ein laufender Koordinator kann nicht zurückgesetzt werden.');
  sequence = 0;
}

module.exports = {
  runExclusive,
  status,
  isBusy: () => !!active,
  _test: { resetForTests }
};
