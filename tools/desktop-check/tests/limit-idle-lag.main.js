/*
 * Technically Not tools · desktop-check/tests/limit-idle-lag.main.js — Main-process side of
 * limit-idle-lag.js: writes the fake CLI (a node script that prints a Claude Code style usage-limit
 * line, then redraws a small status area once a second, and after the resume message prints a short
 * burst of work), and reads renderer counters over DevTools (DOM nodes, JS listeners, heap after
 * GC, CPU profile). No agent CLI is started, no prompt reaches a model.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { summarize } = require('./typing-lag.main.js');

const FAKE = `
const tick = +process.argv[2] || 1000, inBox = process.argv[3] === 'box';
const out = s => process.stdout.write(s);
// Built from parts so this file's own text never holds the phrase.
const LIMIT = ['5-hour limit', ' reached', ' \\u2219 resets 11:58pm'].join('');
out('\\u23fa Working on the task\\r\\n  \\u23bf  ' + LIMIT + '\\r\\n     /upgrade to increase your usage limit.\\r\\n\\r\\n');
let n = 0, working = 0, drawn = 0;
function box() {
  const lines = [
    (working ? '\\u273b Continuing\\u2026 (' + working + 's \\u00b7 esc to interrupt)' : (inBox ? '  ' + LIMIT : '  Waiting') + ' \\u00b7 ' + (++n) + 's'),
    '\\u256d' + '\\u2500'.repeat(60) + '\\u256e',
    '\\u2502 > ' + ' '.repeat(57) + '\\u2502',
    '\\u2570' + '\\u2500'.repeat(60) + '\\u256f',
    '  ? for shortcuts',
  ];
  out((drawn ? '\\x1b[' + drawn + 'A\\r\\x1b[J' : '') + lines.map(l => '\\x1b[2m' + l + '\\x1b[0m').join('\\r\\n') + '\\r\\n');
  drawn = lines.length;
}
setInterval(box, tick);
process.stdin.setRawMode?.(true); process.stdin.resume();
let got = '';
process.stdin.on('data', d => {
  got = (got + d.toString()).slice(-400);
  if (/usage limit has reset/.test(got) && /\\r/.test(got)) {
    got = ''; working = 1; let lines = 0;
    const burst = setInterval(() => {
      out('\\x1b[' + drawn + 'A\\r\\x1b[J'); drawn = 0;
      for (let i = 0; i < 8; i++) out('  \\x1b[32m\\u23bf\\x1b[0m  Read src/file-' + (lines++) + '.js \\x1b[2m(120 lines)\\x1b[0m some output text for the resumed task\\r\\n');
      box(); if (lines >= 240) { clearInterval(burst); working = 0; }
      else working = Math.ceil(lines / 16);
    }, 100);
  }
});
`;

module.exports = win => {
  const dbg = () => {
    const d = win.webContents.debugger;
    if (!d.isAttached()) d.attach('1.3');
    return d;
  };
  return {
    fake() {
      const file = path.join(os.tmpdir(), 'tnai-limit-idle-fake.js');
      fs.writeFileSync(file, FAKE);
      return file;
    },
    async counters() {
      const d = dbg();
      await d.sendCommand('HeapProfiler.enable').catch(() => {});
      await d.sendCommand('HeapProfiler.collectGarbage').catch(() => {});
      const dom = await d.sendCommand('Memory.getDOMCounters');
      const heap = await d.sendCommand('Runtime.getHeapUsage');
      return {
        nodes: dom.nodes,
        listeners: dom.jsEventListeners,
        documents: dom.documents,
        heapMB: Math.round((heap.usedSize / 1048576) * 10) / 10,
      };
    },
    async profileStart() {
      const d = dbg();
      await d.sendCommand('Profiler.enable');
      await d.sendCommand('Profiler.setSamplingInterval', { interval: 500 });
      await d.sendCommand('Profiler.start');
      return true;
    },
    async profileStop() {
      return summarize((await dbg().sendCommand('Profiler.stop')).profile);
    },
    // Heap snapshot → live objects per constructor (count, self bytes); the second call returns
    // what grew since the first.
    async heapDiff() {
      const d = dbg();
      let chunks = [];
      const onChunk = (e, method, params) => {
        if (method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(params.chunk);
      };
      d.on('message', onChunk);
      await d.sendCommand('HeapProfiler.enable');
      await d.sendCommand('HeapProfiler.collectGarbage');
      await d.sendCommand('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      d.removeListener('message', onChunk);
      const snap = JSON.parse(chunks.join(''));
      chunks = null;
      const m = snap.snapshot.meta,
        F = m.node_fields.length,
        ti = m.node_fields.indexOf('type'),
        ni = m.node_fields.indexOf('name'),
        si = m.node_fields.indexOf('self_size');
      const types = m.node_types[0],
        agg = new Map(),
        N = snap.nodes;
      for (let i = 0; i < N.length; i += F) {
        const t = types[N[i + ti]];
        const k =
          t +
          ':' +
          (t === 'string' || t === 'concatenated string' || t === 'sliced string'
            ? ''
            : String(snap.strings[N[i + ni]]).slice(0, 60));
        const a = agg.get(k) || [0, 0];
        a[0]++;
        a[1] += N[i + si];
        agg.set(k, a);
      }
      const prev = this._heap;
      this._heap = agg;
      if (!prev) return null;
      return [...agg]
        .map(([k, [c, s]]) => [k, c - (prev.get(k)?.[0] || 0), s - (prev.get(k)?.[1] || 0)])
        .filter(x => x[2] > 20000 || x[1] > 200)
        .sort((a, b) => b[2] - a[2])
        .slice(0, 15)
        .map(([k, c, s]) => k + ' +' + c + ' (' + Math.round(s / 1024) + ' KB)');
    },
    cleanup() {
      try {
        fs.unlinkSync(path.join(os.tmpdir(), 'tnai-limit-idle-fake.js'));
      } catch {}
      return true;
    },
  };
};
