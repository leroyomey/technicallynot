// Test of the limit on `tnai rename` in desktop/agent-mesh.js: node tools/mesh-rename-test.js
// (plain Node; also run it in Electron's Node).
// An agent that renames itself
// every second keeps its ticket stale, so another computer's Stop and Interrupt never reach it. At
// most one rename a minute for an agent, counted only while a paired computer has full control
// here; with several computers off the command is as it always was. The real `tnai` shim
// (desktop/agent-shim.js) talks to the real mesh, as tools/desktop-check/mesh-commands-check.js
// does; the terminal list, the window (which applies a rename) and the "does a paired computer have
// full control" answer are stand-ins. The mesh's clock is this process's Date.now, moved by hand
// for the minute. No CLI or agent runs, no window opens.
'use strict';
const Module = require('module'),
  os = require('os'),
  path = require('path'),
  fs = require('fs');
const { execFile } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-rename-')),
  userData = path.join(tmp, 'userData'),
  project = path.join(tmp, 'project');
fs.mkdirSync(project, { recursive: true });
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron' ? { app: { getPath: () => userData }, dialog: {} } : load(req, ...rest);
const mesh = require('../desktop/agent-mesh');
Module._load = load;

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const SHIM = path.join(__dirname, '..', 'desktop', 'agent-shim.js');
const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift; // the mesh reads the time through this

(async () => {
  const names = new Map([
      ['pane-A', 'Alpha'],
      ['pane-B', 'Beta'],
    ]),
    asked = [];
  let limited = true,
    apply = true,
    limitAsked = 0;
  const publish = () => mesh.setNames([...names].map(([paneId, name]) => ({ paneId, name })));
  const sessions = ['pane-A', 'pane-B'].map(paneId => ({
    paneId,
    running: true,
    agent: 'Claude Code',
    mode: 'run',
    lastOutputAt: 0,
    startedAt: realNow(),
  }));

  // The window's side: a rename asked by an agent is applied like the user's own, and the names are
  // published again.
  mesh.init(
    (channel, payload) => {
      if (channel !== 'lifecycle:rename') return;
      asked.push(payload);
      if (apply) {
        names.set(payload.paneId, payload.name);
        publish();
      }
    },
    {
      ptys: { list: () => sessions, replay: () => null, write: () => {} },
      turns: { stopped: () => 'reply', busy: () => true },
      attention: { blocker: () => null, hasDraft: () => false },
      projects: async () => [project],
      hooks: { note() {}, launchOptions: async () => ({}) },
      lifecycle: {
        note() {},
        instanceOf: p => 'inst-' + p,
        lookup: () => null,
        info: () => ({ subagent: false }),
        startedOpen: () => 0,
      },
      submit: async () => ({ ok: true, state: 'sent' }),
      renameLimited: () => {
        limitAsked++;
        return limited;
      },
    }
  );
  publish();
  const envOf = async paneId => {
    const add = await mesh.prepare(paneId, project, project);
    const env = { ...process.env };
    add(env);
    return env;
  };
  const env = { A: await envOf('pane-A'), B: await envOf('pane-B') };
  const tnai = (who, ...argv) =>
    new Promise(resolve =>
      execFile(
        process.execPath,
        [SHIM, 'tnai', ...argv],
        { cwd: project, env: env[who], windowsHide: true, timeout: 60000 },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
      )
    );

  // ---- a paired computer has full control here ----
  let r = await tnai('A', 'rename', 'Cedar');
  check(
    'the first rename goes through as always',
    r.code === 0 &&
      /Renamed from Alpha to Cedar/.test(r.out) &&
      names.get('pane-A') === 'Cedar' &&
      asked.length === 1,
    r.out
  );
  r = await tnai('A', 'rename', 'Birch');
  const left = Number(/Wait (\d+) seconds/.exec(r.out)?.[1]);
  check(
    'a second one inside the minute is refused: nothing is asked of the window, the name stays, and the agent is told how long to wait and what to run then',
    r.code !== 0 &&
      /renamed yourself less than a minute ago/.test(r.out) &&
      left > 50 &&
      left <= 60 &&
      /tnai rename Birch/.test(r.out) &&
      /You are still Cedar/.test(r.out) &&
      names.get('pane-A') === 'Cedar' &&
      asked.length === 1,
    r.out
  );
  r = await tnai('A', 'rename', 'Cedar');
  check(
    'the answers that were there before come first and are unchanged: the name it already has',
    r.code === 0 && /already named Cedar/.test(r.out) && asked.length === 1,
    r.out
  );
  r = await tnai('A', 'rename', 'Beta');
  check(
    '…and a name another agent has',
    r.code !== 0 && /Another agent is already named Beta/.test(r.out) && asked.length === 1,
    r.out
  );
  r = await tnai('B', 'rename', 'Moss');
  check(
    'the minute is per agent: another agent renames itself at once',
    r.code === 0 && names.get('pane-B') === 'Moss' && asked.length === 2,
    r.out
  );
  shift += 59000;
  r = await tnai('A', 'rename', 'Birch');
  check(
    '59 seconds later: still refused',
    r.code !== 0 && /Wait \d+ seconds/.test(r.out) && names.get('pane-A') === 'Cedar'
  );
  shift += 2000;
  r = await tnai('A', 'rename', 'Birch');
  check(
    'a minute after the first: it goes through, and the next minute starts',
    r.code === 0 &&
      names.get('pane-A') === 'Birch' &&
      (await tnai('A', 'rename', 'Aspen')).code !== 0 &&
      names.get('pane-A') === 'Birch',
    r.out
  );

  // A rename the window does not apply still counts: the minute runs from the moment one is sent.
  shift += 61000;
  apply = false;
  const n0 = asked.length;
  r = await tnai('A', 'rename', 'Larch');
  check(
    'a rename the window did not apply is reported as before',
    r.code !== 0 &&
      /did not apply the name Larch/.test(r.out) &&
      asked.length === n0 + 1 &&
      names.get('pane-A') === 'Birch',
    r.out
  );
  apply = true;
  r = await tnai('A', 'rename', 'Elm');
  check(
    '…and it still counts: the next try inside the minute is refused',
    r.code !== 0 && /less than a minute ago/.test(r.out) && asked.length === n0 + 1,
    r.out
  );

  // ---- several computers off, nothing paired, or no computer with full control: the command is as
  // it always was ----
  shift += 61000;
  limited = false;
  const before = limitAsked;
  const a1 = await tnai('A', 'rename', 'One'),
    a2 = await tnai('A', 'rename', 'Two'),
    a3 = await tnai('A', 'rename', 'Three');
  check(
    'with no paired computer in control, three renames in a row all go through',
    a1.code === 0 && a2.code === 0 && a3.code === 0 && names.get('pane-A') === 'Three',
    [a1.out, a2.out, a3.out].map(s => s.trim().slice(0, 40))
  );
  limited = true;
  r = await tnai('A', 'rename', 'Four');
  check(
    'the moment a computer gets full control, the last rename counts: the limit holds from the first second',
    r.code !== 0 &&
      /less than a minute ago/.test(r.out) &&
      names.get('pane-A') === 'Three' &&
      limitAsked > before,
    r.out
  );

  // ---- the panel is closed: its count goes with it ----
  mesh.forget('pane-B');
  names.delete('pane-B');
  publish();
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'agent-mesh.js'), 'utf8'),
    main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  check(
    "a closed panel's count is dropped with the panel, and the limit is asked for only after the answers that never needed it",
    /forget\(paneId\)\s*\{\s*lastShot\.delete\(paneId\);\s*renamedAt\.delete\(paneId\);/.test(
      src
    ) &&
      src.indexOf('Another agent is already named') < src.indexOf('deps.renameLimited?.()') &&
      src.indexOf('deps.renameLimited?.()') < src.indexOf("send('lifecycle:rename'")
  );

  // What "limited" means is the remote service's to say (whether a paired computer has full control
  // here; tools/remote-service-test.js is where that answer is tested). Here: the app asks it, and
  // an answer that cannot be read is "limited".
  check(
    "the app hands the mesh the remote service's answer, and if that cannot be read it is limited",
    /renameLimited:\s*\(\)\s*=>\s*\{\s*try\s*\{\s*[^}]*\bremote\.[^}]*\}\s*catch\s*\{\s*return true;\s*\}\s*\}/.test(
      main
    ),
    (/renameLimited:[\s\S]{0,160}/.exec(main) || [''])[0]
  );

  Date.now = realNow;
  mesh.stop();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* temp */
  }
  console.log(
    `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.log('ERROR ' + (e.stack || e));
  process.exit(1);
});
