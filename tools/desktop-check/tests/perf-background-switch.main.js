/*
 * Technically Not tools · desktop-check/tests/perf-background-switch.main.js — Main-process side of
 * perf-background-switch.js: a timer that fires the background pushes a busy session sends while
 * the user clicks between pages, through the real main-process paths where they exist: finished
 * turns with a "Technically Not report" (real agent-lifecycle.js + agent-context.js, as
 * next-actions.main.js), Needs you changes (`attention:change`), Claude Code hook events
 * (`agent:event`) and file watcher batches (`fs:changes`). Nothing is launched, no prompt is sent.
 * `[tnai stall]` lines are captured as in perf-new-task.main.js (without its fake CLIs).
 */
'use strict';
const lifecycle = require('../../../desktop/agent-lifecycle');
const context = require('../../../desktop/agent-context');
const fs = require('fs');
const path = require('path');
const files = require('../../../desktop/fs-service');
const { summarize } = require('./typing-lag.main.js');

const REPORT = n =>
  'Done.\n\nTechnically Not report\n- Did: updated the login form (' +
  n +
  ')\n- Next: add a test for the login form; check the README\n';

module.exports = win => {
  const stalls = [],
    realWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const msg = args.map(a => String(a)).join(' ');
    if (msg.includes('[tnai stall]')) stalls.push(msg);
    realWarn(...args);
  };
  let timer = null,
    seq = 5e6,
    n = 0,
    counts = {};
  const send = (ch, payload) => {
    if (!win.isDestroyed()) win.webContents.send(ch, payload);
    counts[ch] = (counts[ch] || 0) + 1;
  };
  const finish = (paneId, name) => {
    const task = '[TN.ai] Background task ' + ++n;
    lifecycle.started({
      paneId,
      agent: 'Claude Code',
      name,
      root: files.root(),
      cwd: files.root(),
      sessionId: 'perf-' + paneId,
    });
    const t = {
      paneId,
      agent: 'Claude Code',
      source: 'test',
      startedAt: Date.now() - 30000,
      endedAt: 0,
      endedBy: '',
      tokens: null,
      task,
      result: '',
    };
    lifecycle.onTurn(t);
    context.onTurn(t);
    send('agent:turn', t);
    const done = { ...t, endedAt: Date.now(), endedBy: 'stop', result: REPORT(n) };
    lifecycle.onTurn(done);
    context.onTurn(done);
    send('agent:turn', done);
  };

  // One tick = one kind of push, rotating, so every EVERY_MS something lands; ids are the test's
  // real panel ids.
  const tick = (ids, i) => {
    const id = ids[i % ids.length];
    switch (i % 4) {
      case 0:
        finish(id, 'Perf ' + (i % ids.length));
        break;
      case 1:
        send('attention:change', {
          items:
            i % 8 === 1
              ? [
                  {
                    id: 'menu:' + id,
                    paneId: id,
                    kind: 'menu',
                    detail: 'Continue? (y/n)',
                    since: Date.now(),
                    inferred: true,
                  },
                ]
              : [],
          held: [],
        });
        break;
      case 2:
        send('agent:event', {
          paneId: id,
          seq: ++seq,
          at: Date.now(),
          kind: 'tool',
          tool: 'Edit',
          detail: 'src/login-form.js',
        });
        break;
      case 3:
        send('fs:changes', [{ path: 'src/login-form.js', type: 'change', at: Date.now() }]);
        break;
    }
  };
  return {
    takeStalls: () => stalls.splice(0, stalls.length),
    start(ids, everyMs) {
      this.stop();
      const f = path.join(files.root(), 'src', 'login-form.js');
      if (!fs.existsSync(f)) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, '// test\n');
      }
      counts = {};
      let i = 0;
      timer = setInterval(() => tick(ids, i++), everyMs);
      return true;
    },
    // A project that has been worked on for a while: count finished turns already in the context
    // store before the rounds.
    async seed(ids, count) {
      for (let i = 0; i < count; i++) {
        finish(ids[i % ids.length], 'Perf ' + (i % ids.length));
        if (i % 10 === 9) await new Promise(r => setTimeout(r, 30));
      }
      counts = {};
      return count;
    },
    async profileStart() {
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) dbg.attach('1.3');
      await dbg.sendCommand('Profiler.enable');
      await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 250 });
      await dbg.sendCommand('Profiler.start');
      return true;
    },
    async profileStop() {
      return summarize((await win.webContents.debugger.sendCommand('Profiler.stop')).profile);
    },
    stop() {
      clearInterval(timer);
      timer = null;
      const c = counts;
      counts = {};
      return c;
    },
  };
};
