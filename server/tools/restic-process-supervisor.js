#!/usr/bin/env node
'use strict';

/*
 * Synchron aufgerufener Restic-Prozessgruppen-Supervisor.
 *
 * offsite-maintenance.js bleibt bewusst synchron. Dieser kleine Hilfsprozess
 * kann Restic trotzdem asynchron in einer eigenen POSIX-Prozessgruppe starten
 * und bei Zeitüberschreitung auch dessen Kinder und Enkel beenden. Das
 * strukturierte Ergebnis geht ausschließlich über Dateideskriptor 3 zurück;
 * stdout/stderr gehören unverändert Restic.
 */

const fs = require('fs');
const { spawn } = require('child_process');

const RESULT_FD = 3;
const TERMINATION_GRACE_MS = 500;

function publish(value) {
  try {
    fs.writeFileSync(RESULT_FD, JSON.stringify(value) + '\n', 'utf8');
    return true;
  } catch (error) {
    try {
      process.stderr.write(
        `restic-process-supervisor: Ergebnis konnte nicht veröffentlicht werden: `
        + `${String(error.message || error)}\n`
      );
    } catch (_ignore) { /* letzter Ausweg */ }
    return false;
  }
}

function fail(message) {
  publish({
    code: 127,
    signal: '',
    error: String(message || 'Unbekannter Supervisorfehler.'),
    timedOut: false
  });
  process.exitCode = 0;
}

const timeoutMs = Number(process.argv[2]);
const binary = String(process.argv[3] || '');
const args = process.argv.slice(4);

if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !binary) {
  fail('Ungültiger Supervisor-Aufruf.');
} else {
  const posixGroup = process.platform !== 'win32';
  let child;
  let childClosed = false;
  let childCode = null;
  let childSignal = '';
  let spawnError = null;
  let timedOut = false;
  let groupKillCompleted = false;
  let finished = false;
  let timeoutTimer;
  let killTimer;

  const killTree = (signal) => {
    if (!child || !Number.isSafeInteger(child.pid) || child.pid < 1) return;
    try {
      if (posixGroup) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (!error || error.code !== 'ESRCH') {
        spawnError = spawnError || error;
      }
    }
  };

  const finish = () => {
    if (finished) return;
    if (timedOut && (!groupKillCompleted || !childClosed)) return;
    if (!timedOut && !childClosed && !spawnError) return;
    finished = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (killTimer) clearTimeout(killTimer);
    const result = timedOut
      ? {
        code: 124,
        signal: childSignal,
        error: `Restic-Prozessgruppe überschritt die Zeitgrenze von ${timeoutMs} ms.`,
        timedOut: true
      }
      : {
        code: Number.isSafeInteger(childCode) && childCode >= 0 ? childCode : 127,
        signal: childSignal,
        error: spawnError ? String(spawnError.message || spawnError) : '',
        timedOut: false
      };
    publish(result);
  };

  try {
    child = spawn(binary, args, {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      shell: false,
      windowsHide: true,
      detached: posixGroup
    });
  } catch (error) {
    spawnError = error;
    childClosed = true;
    finish();
  }

  if (child) {
    child.once('error', (error) => {
      spawnError = error;
      // Bei einem Spawnfehler existiert kein zu wartender Prozess. Node
      // liefert derzeit zusätzlich "close"; darauf verlassen wir uns für den
      // fail-closed Ergebniskanal jedoch nicht.
      childClosed = true;
      finish();
    });
    child.once('close', (code, signal) => {
      childClosed = true;
      childCode = code;
      childSignal = String(signal || '');
      finish();
    });

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      // Auch wenn der Gruppenleiter nach SIGTERM sofort endet, wird nach der
      // Gnadenfrist die ursprüngliche Prozessgruppe nochmals mit SIGKILL
      // adressiert. So können ignorierende Enkel nicht weiterlaufen.
      killTimer = setTimeout(() => {
        killTree('SIGKILL');
        groupKillCompleted = true;
        finish();
      }, TERMINATION_GRACE_MS);
    }, timeoutMs);
  }
}
