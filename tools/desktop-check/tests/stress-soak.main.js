/*
 * Technically Not tools · desktop-check/tests/stress-soak.main.js — Main-process side of
 * stress-soak.js: launch timestamps, renderer memory after a forced GC (heap, DOM counters,
 * window/document listeners over DevTools), main-process memory, the app's child processes (pty
 * shells), extra project folders + a stubbed folder picker, and a CPU profile of the window across
 * a reload summed by file.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app, dialog } = require('electron');

const processStart = Date.now() - process.uptime() * 1000;
module.exports = (win, profile) => {
  const marks = { processStart, mainLoaded: Date.now() };
  win.once('ready-to-show', () => {
    marks.readyToShow = Date.now();
  });
  win.once('show', () => {
    marks.shown = Date.now();
  });
  win.webContents.once('did-finish-load', () => {
    marks.didFinishLoad = Date.now();
  });
  let next = null;
  dialog.showOpenDialog = async () =>
    next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
  const dbg = win.webContents.debugger;
  const attach = async () => {
    if (!dbg.isAttached()) dbg.attach('1.3');
  };
  const listeners = async expr => {
    const { result } = await dbg.sendCommand('Runtime.evaluate', {
      expression: expr,
      objectGroup: 'soak',
    });
    const { listeners: l } = await dbg.sendCommand('DOMDebugger.getEventListeners', {
      objectId: result.objectId,
    });
    const byType = {};
    l.forEach(x => {
      byType[x.type] = (byType[x.type] || 0) + 1;
    });
    return { total: l.length, byType };
  };

  // Off Windows the same list comes from ps, one "pid ppid name" per line.
  const [cmd, cmdArgs] =
    process.platform === 'win32'
      ? [
          'powershell',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress',
          ],
        ]
      : ['ps', ['-eo', 'pid=,ppid=,comm=']];
  const tree = () =>
    new Promise(resolve =>
      execFile(cmd, cmdArgs, { maxBuffer: 16 << 20, windowsHide: true }, (err, out) => {
        if (err) return resolve({ error: err.message });
        const all =
            process.platform === 'win32'
              ? JSON.parse(out)
              : out
                  .trim()
                  .split('\n')
                  .map(l => l.trim().split(/\s+/))
                  .map(([p, pp, ...n]) => ({
                    ProcessId: +p,
                    ParentProcessId: +pp,
                    Name: n.join(' '),
                  })),
          kids = new Map();
        all.forEach(p => {
          if (!kids.has(p.ParentProcessId)) kids.set(p.ParentProcessId, []);
          kids.get(p.ParentProcessId).push(p);
        });
        const byPid = new Map(all.map(p => [p.ProcessId, p]));
        const found = [],
          walk = pid =>
            (kids.get(pid) || []).forEach(p => {
              if (p.ProcessId !== pid) {
                found.push(p);
                walk(p.ProcessId);
              }
            });
        walk(process.pid);
        const byName = {},
          parents = {};
        found.forEach(p => {
          byName[p.Name] = (byName[p.Name] || 0) + 1;
          const k = p.Name + '<' + (byPid.get(p.ParentProcessId)?.Name || '?');
          parents[k] = (parents[k] || 0) + 1;
        });
        resolve({ total: found.length, byName, parents });
      })
    );
  return {
    marks: () => marks,
    progress(line) {
      process.stdout.write('[soak] ' + line + '\n');
      return true;
    }, // streamed at once: the final log prints only when the run ends
    loops: () => +process.env.TNAI_SOAK_LOOPS || 40,
    // ms between pane closes; 0 = all at once, as closing a workspace does
    closeGap: () => +process.env.TNAI_SOAK_CLOSE_GAP || 0,
    // to narrow a failure down
    phases: () => (process.env.TNAI_SOAK_PHASES || 'panes,projects,ui').split(','),
    make(name) {
      const dir = path.join(profile, name);
      fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'README.md'), '# ' + name + '\n');
      fs.writeFileSync(path.join(dir, 'lib', name + '.js'), '// ' + name + '\n');
      return dir;
    },
    pickNext(dir) {
      next = dir;
      return true;
    },
    // Renderer + main memory after a forced GC in both.
    async sample() {
      await attach();
      await dbg.sendCommand('HeapProfiler.collectGarbage');
      await dbg.sendCommand('HeapProfiler.collectGarbage');
      if (global.gc) global.gc();
      const heap = await dbg.sendCommand('Runtime.getHeapUsage');
      const dom = await dbg.sendCommand('Memory.getDOMCounters');
      const winL = await listeners('window'),
        docL = await listeners('document');
      await dbg.sendCommand('Runtime.releaseObjectGroup', { objectGroup: 'soak' });
      const mem = process.memoryUsage();
      const metrics = app.getAppMetrics().map(m => ({ type: m.type, kb: m.memory.workingSetSize }));
      return {
        heapMB: +(heap.usedSize / 1048576).toFixed(2),
        nodes: dom.nodes,
        docs: dom.documents,
        jsListeners: dom.jsEventListeners,
        winListeners: winL,
        docListeners: docL,
        mainHeapMB: +(mem.heapUsed / 1048576).toFixed(2),
        mainRssMB: +(mem.rss / 1048576).toFixed(1),
        metrics,
      };
    },
    children: tree,
    async profileStart() {
      await attach();
      await dbg.sendCommand('Profiler.enable');
      await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 100 });
      await dbg.sendCommand('Profiler.start');
      return true;
    },
    async profileStop() {
      const { profile: p } = await dbg.sendCommand('Profiler.stop');
      const self = new Map(),
        byId = new Map(p.nodes.map(n => [n.id, n])),
        dt = p.timeDeltas;
      p.samples.forEach((id, i) => {
        const d = (dt[i + 1] ?? 0) / 1000;
        self.set(id, (self.get(id) || 0) + d);
      });
      const file = new Map(),
        fn = new Map();
      for (const [id, ms] of self) {
        const cf = byId.get(id).callFrame,
          f = (cf.url || '').split(/[\\/]/).pop() || '(' + (cf.functionName || 'native') + ')';
        file.set(f, (file.get(f) || 0) + ms);
        const k = (cf.functionName || '(anon)') + ' ' + f + ':' + (cf.lineNumber + 1);
        fn.set(k, (fn.get(k) || 0) + ms);
      }
      const top = (m, n) =>
        [...m]
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([k, v]) => v.toFixed(1).padStart(7) + ' ms  ' + k);
      return { files: top(file, 25), fns: top(fn, 25) };
    },
  };
};
