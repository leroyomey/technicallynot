/*
 * Technically Not tools · desktop-check/retire-check.js — A retired agent (it handed its work over)
 * points `tnai send` to its successor (desktop/agent-lifecycle.js retire/successorOf). Regression
 * 2026-09-28: Rook's `tnai send Lead` reopened the retired Lead's long conversation instead of
 * reaching Lead 2. No Electron window: electron's `app` is stubbed and the state file goes to a
 * temp folder. Run: node tools/desktop-check/retire-check.js
 */
'use strict';
const os = require('os'),
  path = require('path'),
  fs = require('fs'),
  Module = require('module');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-retire-'));
const load = Module._load;
Module._load = function (req, ...rest) {
  return req === 'electron' ? { app: { getPath: () => tmp } } : load.call(this, req, ...rest);
};
const life = require('../../desktop/agent-lifecycle');
Module._load = load;
let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const root = 'C:\work\proj';
life.init(() => {}, { root: () => root, canResume: () => true });
const open = (paneId, name, sessionId) => {
  life.started({ paneId, agent: 'Claude Code', name, sessionId, root, cwd: root });
  life.setNames([{ paneId, name }]);
};
open('p-lead', 'Lead', 's-lead');
open('p-cinder', 'Cinder', 's-cinder');
open('p-rook', 'Rook', 's-rook');
const lead = life.lookup('Lead', root).instanceId;
check(!life.successorOf(lead), 'an agent that never handed over has no successor');
check(life.retire('p-lead', 'p-cinder') === true, 'retire links Lead to Cinder');
check(life.retire('p-lead', 'p-lead') === false, 'an agent cannot be its own successor');
life.closed('p-lead');
const hit = life.lookup('Lead', root);
check(
  hit.state === 'hidden' && hit.successor === 'Cinder',
  'the closed Lead lists Cinder as its successor'
);
check(life.successorOf(lead)?.paneId === 'p-cinder', 'send to Lead resolves to the live Cinder');
open('p-next', 'Lead 3', 's-next');
life.retire('p-cinder', 'p-next');
life.closed('p-cinder');
check(
  life.successorOf(lead)?.name === 'Lead 3',
  'a chain of hand-offs resolves to the newest agent'
);
check(!life.successorOf(life.lookup('Rook', root).instanceId), 'Rook, never retired, is untouched');
life.started({
  paneId: 'p-again',
  agent: 'Claude Code',
  name: 'Lead',
  resumeId: 's-lead',
  root,
  cwd: root,
});
check(
  !life.successorOf(lead),
  'reopening the retired conversation makes it an ordinary agent again'
);

// A reused name: the closed Lead keeps its name, a new Lead is made; the
// name reaches the new one, the old one by id.
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
life.closed('p-again');
pause();
life.started({
  paneId: 'p-lead2',
  agent: 'Claude Code',
  name: 'Lead',
  sessionId: 's-lead2',
  root,
  cwd: root,
});
const lead2 = life.lookup('Lead', root);
check(
  lead2 && !lead2.ambiguous && lead2.instanceId !== lead && lead2.paneId === 'p-lead2',
  'a name shared with a closed agent reaches the one whose panel is open'
);
life.closed('p-lead2');
check(
  life.lookup('Lead', root).instanceId === lead2.instanceId,
  'with both closed, the name reaches the most recently used one'
);
check(
  life.lookup(lead, root).instanceId === lead,
  'the older closed agent is still reached by its id'
);
life.flushSaves();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? 'PASS' : 'FAILED');
process.exit(ok ? 0 : 1);
