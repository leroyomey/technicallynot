/*
 * Technically Not tools · desktop-check/tests/perf-new-task.main.js — main-process helper shared
 * by perf-page-switch, perf-background-switch and send-switch (their main halves require it). The
 * test it was written for is gone (2026-10-13: it opened the old Terminal page and started
 * processes that spin the CPU, which no test may do):
 * - Captures the `[tnai stall]` warnings desktop/stall-log.js prints on the main process's own
 * console (event-loop stalls over 100 ms).
 * - Puts fake `claude`/`codex`/`cursor-agent` CLIs on PATH (reusing agent-mesh.main.js's fake CLI —
 * never the real ones, no credits), so "add a new task" can go through Technically Not's real
 * agent-detect + agent-launch path (10-live-terminals.js openIn) without any real agent CLI
 * installed.
 */
'use strict';

module.exports = (win, profile) => {
  const stalls = [];
  const realWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
    if (msg.includes('[tnai stall]')) stalls.push(msg);
    realWarn(...args);
  };

  // fake claude/codex/cursor-agent CLIs on PATH
  const mesh = require('./agent-mesh.main.js')(win, profile);

  return {
    // Stalls logged since the last call (clears the buffer).
    takeStalls() {
      return stalls.splice(0, stalls.length);
    },
    paths: mesh.paths,
  };
};
