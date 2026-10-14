// Technically Not tools · desktop-check/tests/idle-work.main.js — Main-process side of
// idle-work.js: a steady, ordinary amount of agent activity (hook tool events through the real
// agent-hooks.js, pushed turns, file writes the project watcher sees; the rates of typing-lag's
// normal run), a CPU profile of the window summed per script file (self time, and inclusive time:
// every file anywhere in a sample's stack), and minimize / restore of the window.
'use strict';
const fs = require('fs');
const path = require('path');
const hooks = require('../../../desktop/agent-hooks');
const files = require('../../../desktop/fs-service');

module.exports = win => {
  const dbg = win.webContents.debugger;
  let timers = [];
  return {
    // Until stop(): every pane gets a tool event on a real project file every 100 ms and a turn
    // update every 500 ms; one of 5 project files is rewritten every 250 ms.
    start(paneIds) {
      const root = files.root(),
        started = Date.now() - 5000;
      let n = 0;
      try {
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        for (let i = 0; i < 5; i++)
          fs.writeFileSync(path.join(root, 'src', 'gen-' + i + '.js'), '// 0\n');
      } catch {}
      const tools = ['Read', 'Edit', 'Read', 'Write'];
      timers = [
        setInterval(() => {
          n++;
          paneIds.forEach((paneId, i) =>
            hooks.note(paneId, {
              kind: 'tool',
              tool: tools[(n + i) % 4],
              detail: path.join(root, 'src', 'gen-' + ((n + i) % 5) + '.js'),
            })
          );
        }, 100),
        setInterval(
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
          500
        ),
        setInterval(() => {
          try {
            fs.writeFileSync(path.join(root, 'src', 'gen-' + (n % 5) + '.js'), '// ' + n + '\n');
          } catch {}
        }, 250),
      ];
      return true;
    },
    stop() {
      timers.forEach(clearInterval);
      timers = [];
      return true;
    },
    async profileStart() {
      if (!dbg.isAttached()) dbg.attach('1.3');
      await dbg.sendCommand('Profiler.enable');
      await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 250 });
      await dbg.sendCommand('Profiler.start');
      return true;
    },
    // { total, busy, self: { file: ms }, incl: { file: ms } }; busy = everything but (idle).
    async profileStop() {
      const { profile } = await dbg.sendCommand('Profiler.stop');
      const byId = new Map(profile.nodes.map(n => [n.id, n])),
        parent = new Map(),
        dt = profile.timeDeltas;
      for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
      const fileOf = cf =>
        (cf.url || '').split(/[\\/]/).pop() || '(' + (cf.functionName || 'native') + ')';
      const fnOf = cf =>
        (cf.functionName || '(anon)') + ' ' + fileOf(cf) + ':' + (cf.lineNumber + 1);
      const self = {},
        incl = {},
        fnSelf = {},
        fnIncl = {};
      let total = 0,
        busy = 0;
      profile.samples.forEach((id, i) => {
        const ms = (dt[i + 1] ?? 0) / 1000,
          cf = byId.get(id).callFrame,
          f = fileOf(cf);
        total += ms;
        if (cf.functionName !== '(idle)') busy += ms;
        self[f] = (self[f] || 0) + ms;
        const seen = new Set();
        if (cf.functionName !== '(idle)') fnSelf[fnOf(cf)] = (fnSelf[fnOf(cf)] || 0) + ms;
        for (let p = id; p; p = parent.get(p)) {
          const pcf = byId.get(p).callFrame,
            pf = fileOf(pcf),
            k = fnOf(pcf);
          if (!/\.js$/.test(pf)) continue;
          if (!seen.has(pf)) {
            seen.add(pf);
            incl[pf] = (incl[pf] || 0) + ms;
          }
          if (!seen.has(k)) {
            seen.add(k);
            fnIncl[k] = (fnIncl[k] || 0) + ms;
          }
        }
      });

      // By function: the 14 with the most own time, and the 18 with the most time including what
      // they call.
      const top = (m, n) =>
        Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([k, v]) => Math.round(v) + ' ' + k);
      return {
        total: Math.round(total),
        busy: Math.round(busy),
        self,
        incl,
        fnSelf: top(fnSelf, 14),
        fnIncl: top(fnIncl, 18),
      };
    },
    // The app's own CPU use per process kind since the last call (percent of one core), as in
    // idle-cost.main.js.
    cpu() {
      const out = {};
      for (const m of require('electron').app.getAppMetrics()) {
        const k =
          m.type === 'Tab'
            ? 'window'
            : m.type === 'GPU'
              ? 'graphics'
              : m.type === 'Browser'
                ? 'main'
                : 'other';
        out[k] = Math.round(((out[k] || 0) + (m.cpu?.percentCPUUsage || 0)) * 10) / 10;
      }
      return out;
    },
    throttling: () => win.webContents.getBackgroundThrottling(),
    minimize() {
      win.minimize();
      return true;
    },
    restore() {
      win.restore();
      return !win.isMinimized();
    },
    isMinimized: () => win.isMinimized(),
  };
};
