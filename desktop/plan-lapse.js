/*
 * Technically Not desktop · plan-lapse.js — What a plan lock does to panels that are already open.
 * Agents keep working until their current turn
 * ends; nothing here stops them (main.js refuses new prompts, panels and typing while locked). Open
 * PowerShell panels (agent 'Terminal', not a sign-in) get one notice, then their shell is stopped
 * 10 minutes later, so an open shell can't keep starting CLIs after the plan ends. A panel whose
 * turn is still running at that moment gets until its turn ends. Unlocking in time cancels it. The
 * panel stays open with its output readable; only its process ends. State goes to the window as
 * `auth:lapse` { closeAt, panes }.
 */
'use strict';
const buildInfo = require('./build-info');

// 10 minutes; a copy run from source under a self-test may shorten it (TNAI_LAPSE_SHELL_MS,
// tools/desktop-check/tests/plan-lapse.main.js).
const shellMs = () =>
  !buildInfo.release && process.env.TNAI_SELFTEST && Number(process.env.TNAI_LAPSE_SHELL_MS) > 0
    ? Number(process.env.TNAI_LAPSE_SHELL_MS)
    : 10 * 60e3;

// a shell whose CLI turn is still running is looked at again this often (a turn end has no event
// for hand-started CLIs)
const TURN_WAIT_MS = 15e3;

let deps = null,
  closeAt = 0,
  timer = null;
const shells = () =>
  deps.ptys.list().filter(p => p.agent === 'Terminal' && p.mode !== 'login' && p.pid);
const publish = () =>
  deps.send('auth:lapse', { closeAt, panes: closeAt ? shells().map(p => p.paneId) : [] });

function closeShells() {
  timer = null;
  const open = shells();
  const busy = open.filter(p => deps.turns?.busy?.(p.paneId));
  for (const p of open) if (!busy.includes(p)) deps.ptys.stop(p.paneId);
  if (busy.length) {
    timer = setTimeout(closeShells, TURN_WAIT_MS);
    return;
  }
  closeAt = 0;
  publish();
}

// Called with every lock state (main.js, on auth:changed).
function lockChanged(lock) {
  if (!deps) return;
  if (lock?.locked) {
    if (closeAt) return;
    if (!shells().length) return;
    const ms = shellMs();
    closeAt = Date.now() + ms;
    timer = setTimeout(closeShells, ms);
    const min = Math.round(ms / 60e3);
    deps.send('auth:notice', {
      message:
        'Technically Not is locked. Agents that are working finish their current task. Open PowerShell threads close in ' +
        (min >= 1 ? min + ' minute' + (min === 1 ? '' : 's') : 'a moment') +
        '.',
    });
    publish();
  } else if (closeAt || timer) {
    clearTimeout(timer);
    timer = null;
    closeAt = 0;
    publish();
  }
}

module.exports = {
  init(d) {
    deps = d;
  },
  lockChanged,
  state: () => ({ closeAt, panes: closeAt ? shells().map(p => p.paneId) : [] }),
};
