/*
 * Technically Not tools · desktop-check/tests/perf-page-switch.main.js — Main-process side of
 * perf-page-switch.js: perf-new-task.main.js's fake agent CLIs on PATH + `[tnai stall]` capture,
 * pty resizes counted per pane (as agents-speed.main.js), a fake full-screen TUI that redraws
 * REDRAW_LINES lines on every resize (Claude Code redraws its whole conversation when its pty is
 * resized) and ticks a line every 30 ms, and a CPU profile of the window and of main over DevTools
 * (typing-lag.main.js summary).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const inspector = require('inspector');
const ptys = require('../../../desktop/pty-service');
const { summarize } = require('./typing-lag.main.js');
const post = (session, method, params) =>
  new Promise((resolve, reject) =>
    session.post(method, params || {}, (err, res) => (err ? reject(err) : resolve(res)))
  );

const TUI = `const tag = process.argv[2] || 'T', N = +process.argv[3] || 1500;
let redraws = 0;
const draw = () => { redraws++; const w = Math.max(20, (process.stdout.columns || 80) - 40); let s = '\\x1b[2J\\x1b[3J\\x1b[H';
  for (let i = 0; i < N; i++) s += '\\x1b[' + (31 + i % 6) + 'm' + tag + ' redraw ' + redraws + ' line ' + i + ' ' + '#'.repeat(w) + '\\x1b[0m\\r\\n';
  process.stdout.write(s); };
if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); } // Windows: resize events come through raw console input
draw(); process.stdout.on('resize', draw);
let i = 0; setInterval(() => process.stdout.write('\\x1b[' + (31 + i % 6) + 'm' + tag + ' tick ' + (i++) + ' redraws ' + redraws + '\\x1b[0m\\r\\n'), 30);
`;

module.exports = (win, profile) => {
  const base = require('./perf-new-task.main.js')(win, profile);
  const counts = {},
    real = ptys.resize;
  ptys.resize = (paneId, cols, rows) => {
    (counts[paneId] ||= []).push(cols + 'x' + rows);
    return real.call(ptys, paneId, cols, rows);
  };
  const tui = path.join(profile, 'fake-tui.js');
  fs.writeFileSync(tui, TUI);
  const dbg = win.webContents.debugger,
    mainSession = new inspector.Session();
  return {
    takeStalls: () => base.takeStalls(),
    tuiPath: () => tui,
    mode: () => process.env.TNAI_PPS_MODE || 'tui',
    tail: paneId =>
      String(ptys.replay(paneId)?.buffer || '')
        .replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '')
        .slice(-300),
    takeResizes() {
      const n = Object.values(counts).reduce((a, l) => a + l.length, 0);
      for (const k of Object.keys(counts)) delete counts[k];
      return n;
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
