/*
 * Technically Not tools · desktop-check/origin-echo-check.js — Which earlier result a composer
 * prompt quotes (desktop/agent-lifecycle.js origin()). Regression: an agent whose result repeated
 * its own task (OpenCode "Vega" echoing the check-3 prompt) "owned" that prompt, so sending the
 * same prompt again on Auto went back to that old agent instead of a new Claude Code lead. A
 * result's own words must still be matched. No real CLI, no Electron window: electron's `app` is
 * stubbed and the state file goes to a temp folder. Run: node
 * tools/desktop-check/origin-echo-check.js
 */
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const Module = require('module');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-origin-'));
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
const root = 'C:\\work\\proj';
life.init(() => {}, { root: () => root, canResume: () => true });

const PROMPT =
  'Run manual check 3, live, no file edits: (1) run tnai new opencode "reply with OPENCODE-NEW-OK"; (2) then start an OpenCode sub-agent with tnai_delegate, task "reply with the word OPENCODE-OK and nothing else", and wait for its report; (3) then start a fresh Cursor Agent sub-agent with task "reply with CURSOR-OK" and wait for its report.';
const OWN =
  'I checked the settings page and found that the save button posts the form twice because the click handler is attached on every render of the panel; I moved it into the mount step so it runs once, and the duplicate request is gone now.';
const turn = (paneId, agent, task, result, at) => {
  life.started({ paneId, agent, root, cwd: root });
  life.onTurn({ paneId, agent, startedAt: at, task });
  life.onTurn({ paneId, agent, startedAt: at, endedAt: at + 1000, task, result });
};
const t0 = Date.now() - 60000;
turn(
  'p-vega',
  'OpenCode',
  PROMPT,
  'Remaining CLI manual check 3. ' + PROMPT + ' Step 1 done, step 2 waiting.',
  t0
);
turn('p-sage', 'Claude Code', 'fix the settings page', OWN, t0 + 5000);

check(
  !life.origin(PROMPT),
  'resending a prompt an agent only echoed back goes to nobody (a new lead), not to that agent'
);
const o = life.origin('Follow up on this: ' + OWN);
check(
  o && o.name !== undefined && /Claude Code/.test(o.agent || ''),
  "quoting an agent's own words still routes to it (" + (o ? o.agent : 'none') + ')'
);
check(life.quotes('x ' + OWN, OWN), 'quotes() itself is unchanged');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? '\norigin-echo-check: all passed' : '\norigin-echo-check: FAILED');
process.exit(ok ? 0 : 1);
