/*
 * Technically Not tools · desktop-check/spawn-origin-check.js — An agent another agent started with
 * `tnai new` is not listed as "started by the user" (desktop/agent-lifecycle.js spawn/revived →
 * startedByAgent, read by agent-mesh.js userKept), also when its pane opened but was not ready in
 * time. No Electron window: electron's `app` is stubbed and the state file goes to a temp folder.
 * Run: node tools/desktop-check/spawn-origin-check.js
 */
'use strict';
const os = require('os'),
  path = require('path'),
  fs = require('fs'),
  Module = require('module');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-spawn-origin-'));
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
const root = 'C:\\work\\proj',
  asks = [];
life.init(
  (channel, req) => {
    if (channel === 'lifecycle:revive') asks.push(req);
  },
  { root: () => root, canResume: () => true }
);
const open = (paneId, name, ownedByUser) => {
  life.started({
    paneId,
    agent: 'Claude Code',
    name,
    sessionId: 's-' + paneId,
    root,
    cwd: root,
    ownedByUser,
  });
  life.setNames([{ paneId, name }]);
};

(async () => {
  open('p-user', 'Iris', true); // the composer's New agent: the user's
  check(!life.startedByAgent('p-user'), "an agent the user started stays the user's");

  // `tnai new` from another agent's panel: the window opens the pane (started) and answers ready.
  let done = life.spawn('Claude Code');
  open('p-hazel', 'Hazel', true);
  life.revived(asks.at(-1).requestId, { paneId: 'p-hazel' });
  await done;
  check(
    life.startedByAgent('p-hazel'),
    '`tnai new` agent that became ready is started by an agent'
  );

  // Its pane opened but the CLI was not ready in time: still not the user's.
  done = life.spawn('Claude Code');
  open('p-pixel', 'Pixel', true);
  life.revived(asks.at(-1).requestId, {
    error: 'Pixel started but is not ready. Check its thread.',
    openedPaneId: 'p-pixel',
  });
  await done;
  check(
    life.startedByAgent('p-pixel'),
    '`tnai new` agent that opened but was not ready is started by an agent'
  );

  // The count the `tnai new` limit uses (agent-graph.js refuseNew): open panels of such agents plus
  // the ones still starting.
  check(
    life.startedOpen() === 2,
    "two `tnai new` agents are open, the user's own is not counted: " + life.startedOpen()
  );
  life.spawn('Claude Code'); // asked for, no panel yet
  check(life.startedOpen() === 3, 'one still starting counts too: ' + life.startedOpen());
  life.revived(asks.at(-1).requestId, { error: 'not started' });
  life.closed('p-pixel');
  check(
    life.startedOpen() === 1,
    'a failed start and a closed panel no longer count: ' + life.startedOpen()
  );

  // Reopening a closed conversation (tnai send to a closed agent) does not change whose it is.
  life.closed('p-user');
  done = life.revive(life.lookup('Iris', root).instanceId);
  open('p-user2', 'Iris', true);
  life.revived(asks.at(-1).requestId, { paneId: 'p-user2' });
  await done;
  check(!life.startedByAgent('p-user2'), "a revived user agent stays the user's");
  check(!life.startedByAgent('p-nobody'), 'an unknown panel is not marked');

  life.flushSaves();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'PASS' : 'FAILED');
  process.exit(ok ? 0 : 1);
})();
