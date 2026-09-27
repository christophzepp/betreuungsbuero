'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');

// Only the listener is adapted; authentication, templates and persistence are real.
module.exports = function appHarness(serverRoot, env) {
  let child, base, output = '';
  return {
    get base() { return base; },
    async start() {
      output = '';
      child = fork(path.join(__dirname, 'server-first-app-process.cjs'), [serverRoot], {
        cwd: serverRoot, env, execArgv: [], silent: true,
      });
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', bytes => { output = (output + bytes.toString()).slice(-16000); });
      }
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Application startup timed out.\n' + output)), 30000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', (code, signal) => {
          clearTimeout(timer);
          reject(new Error(`Application exited before readiness (${code || signal}).\n${output}`));
        });
        child.once('message', message => { clearTimeout(timer); resolve(message); });
      });
      assert.equal(ready.type, 'ready');
      assert.ok(Number.isInteger(ready.port) && ready.port > 0);
      base = `http://127.0.0.1:${ready.port}`;
    },
    async stop() {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await exited; } finally { clearTimeout(timer); }
    },
  };
};
