/*
 * Technically Not tools · desktop-check/tests/typing-lag.main.js — Main-process side of
 * typing-lag.js: a burst of agent activity (hook events through the real agent-hooks.js, pushed
 * turns, file writes the project watcher sees) and a CPU profile of the window over DevTools,
 * summed by function and by file.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const hooks = require('../../../desktop/agent-hooks');
const files = require('../../../desktop/fs-service');

const inspector = require('inspector');
const stress = process.env.TNAI_TYPING_STRESS === '1';
const post = (session, method, params) =>
  new Promise((resolve, reject) =>
    session.post(method, params || {}, (err, res) => (err ? reject(err) : resolve(res)))
  );

module.exports = win => {
  const dbg = win.webContents.debugger,
    mainSession = new inspector.Session();
  return {
    root: () => files.root(),
    config: () => (stress ? { panes: 10, stress: true } : { panes: 4, stress: false }),
    // For `ms`: every pane gets a tool event every 100 ms and a turn update every 500 ms; a project
    // file is rewritten every 250 ms. TNAI_TYPING_STRESS=1: every 25 ms / 125 ms / 60 ms, and file
    // writes spread over 10 files.
    burst(paneIds, ms) {
      const root = files.root(),
        started = Date.now() - 5000;
      let n = 0;
      const tools = ['Read', 'Edit', 'Bash', 'Grep'];
      const ev = setInterval(
        () => {
          n++;
          paneIds.forEach((paneId, i) =>
            hooks.note(paneId, {
              kind: 'tool',
              tool: tools[(n + i) % 4],
              detail: root + '/src/file-' + ((n + i) % 7) + '.js',
            })
          );
        },
        stress ? 25 : 100
      );
      const tu = setInterval(
        () =>
          paneIds.forEach(paneId =>
            win.webContents.send('agent:turn', {
              paneId,
              agent: 'Claude Code',
              source: 'claude-transcript',
              startedAt: started,
              endedAt: 0,
              endedBy: '',
              tokens: { input: 1000 + n, cacheWrite: 500, output: 2000 + n * 10 },
              queued: [],
            })
          ),
        stress ? 125 : 500
      );
      const fw = setInterval(
        () => {
          try {
            fs.writeFileSync(
              path.join(root, 'src', 'gen-' + (n % (stress ? 10 : 5)) + '.js'),
              '// ' + n + '\n'
            );
          } catch {}
        },
        stress ? 60 : 250
      );
      setTimeout(() => {
        clearInterval(ev);
        clearInterval(tu);
        clearInterval(fw);
      }, ms);
      return true;
    },
    async profileStart() {
      if (!dbg.isAttached()) dbg.attach('1.3');
      await dbg.sendCommand('Profiler.enable');
      await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 250 });
      await dbg.sendCommand('Profiler.start');
      mainSession.connect();
      await post(mainSession, 'Profiler.enable');
      await post(mainSession, 'Profiler.setSamplingInterval', { interval: 250 });
      await post(mainSession, 'Profiler.start');
      return true;
    },
    async profileStop() {
      const { profile: mainProfile } = await post(mainSession, 'Profiler.stop');
      mainSession.disconnect();
      return {
        renderer: summarize((await dbg.sendCommand('Profiler.stop')).profile),
        main: summarize(mainProfile),
      };
    },
  };
};
module.exports.summarize = summarize;

// Self time per function and per file (url's last part; native frames by name).
function summarize(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n])),
    self = new Map(),
    dt = profile.timeDeltas;
  let total = 0;
  profile.samples.forEach((id, i) => {
    const d = (dt[i + 1] ?? 0) / 1000;
    total += d;
    self.set(id, (self.get(id) || 0) + d);
  });
  const fn = new Map(),
    file = new Map();
  for (const [id, ms] of self) {
    const cf = byId.get(id).callFrame,
      f = (cf.url || '').split(/[\\/]/).pop() || '(' + (cf.functionName || 'native') + ')';
    const k = (cf.functionName || '(anon)') + ' ' + f + ':' + (cf.lineNumber + 1);
    fn.set(k, (fn.get(k) || 0) + ms);
    file.set(f, (file.get(f) || 0) + ms);
  }
  const top = (m, n) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => v.toFixed(0).padStart(6) + ' ms  ' + k);

  // Who called the 3 hottest non-idle functions: their call paths (6 frames up), summed by self
  // time.
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const name = cf =>
    (cf.functionName || '(anon)') +
    ' ' +
    ((cf.url || '').split(/[\\/]/).pop() || '(' + (cf.functionName || 'native') + ')') +
    ':' +
    (cf.lineNumber + 1);
  const hot = [...fn]
    .filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  const callers = hot.flatMap(k => {
    const paths = new Map();
    for (const [id, ms] of self) {
      if (name(byId.get(id).callFrame) !== k) continue;
      const chain = [];
      for (let p = parent.get(id); p && chain.length < 6; p = parent.get(p)) {
        const cf = byId.get(p).callFrame;
        if (cf.functionName !== '(root)') chain.push(name(cf));
      }
      const key = chain.join(' ← ');
      paths.set(key, (paths.get(key) || 0) + ms);
    }
    return ['  ' + k + ' called from:', ...top(paths, 4).map(s => '    ' + s)];
  });
  return { total: Math.round(total), files: top(file, 15), fns: top(fn, 25), callers };
}
