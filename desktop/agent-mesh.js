/*
 * Technically Not desktop · agent-mesh.js — Every terminal pane gets Technically Not's shim folder
 * first on PATH, a per-pane token and a loopback port (env). The shims (agent-shim.js) report agent
 * CLIs typed by hand (claude / codex / cursor-agent), which then register as live agent sessions of
 * that provider with Technically Not's usual launch additions, and carry the `tnai` command: `tnai
 * agents`, `tnai send NAME message`, `tnai intervene NAME message` (stops a working agent where it
 * is, then hands it the message), `tnai read NAME` between agents whose working folder is in the
 * same open project, and `tnai preview URL [device]` / `tnai preview close [URL]` (shows a
 * localhost dev server in Live preview; closes the tab that agent opened), `tnai shot preview [URL]
 * [device]` (a PNG of it, taken in a hidden window, preview-shot.js), `tnai show FILE.html
 * [device]` (one local HTML file there without a server, cut off from the app and the network,
 * show-file.js). Push only: a hand-launched session lasts exactly as long as its shim's connection.
 * 127.0.0.1 only; every request needs a live pane token.
 */
'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const { nodeHelper, cmdShim, shShim, runtimeEnv } = require('./node-helper');
const crypto = require('crypto');
const { app } = require('electron');
const asks = require('./agent-ask');
const servers = require('./dev-servers');
const tests = require('./test-queue');
const tasks = require('./agent-tasks');
const errors = require('./agent-errors');

// The "try" steps (agent-errors.js) that more than one failure here gives.
const TRY = {
  agents: 'tnai agents',
  again:
    'run the same command again in a few seconds; if it fails again, tell the user Technically Not is not answering',
  devServer:
    'start the dev server in the background, then run this again (tnai server list shows the running ones)',
  short: 'shorten it, or put the details in a file and send its path',
  send: 'tnai send NAME MESSAGE',
};

const SHIMS = {
  claude: 'Claude Code',
  codex: 'Codex',
  'cursor-agent': 'Cursor Agent',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
  copilot: 'GitHub Copilot',
  droid: 'Droid',
  agy: 'Antigravity',
}; // command -> agent id (agent-registry.js)
const LINE_MAX = 256 * 1024; // one request line (a launch carries the user's arguments)

// `tnai intervene`: one interrupt per target agent in this long, so agents cannot keep stopping
// each other
const INTERVENE_GAP_MS = 120000;

// after the interrupt key: how long to wait for Claude Code to show whether it paused the task or
// put its prompt back
const INTERVENE_REPLY_MS = 2500;

// how often, within INTERVENE_REPLY_MS, to look whether it did (agent-turns.js stopped() reads only
// the new end of the transcript, so a short step costs little; 250 ms made the message wait up to
// 250 ms after the stop line was there)
const INTERVENE_CHECK_MS = 50;

// lets the CLI stop and return to its prompt before the message is typed
const INTERVENE_SETTLE_MS = 450;
const intervened = new Map(); // paneId -> when it was last interrupted by another agent
const TEXT_MAX = 4000; // longest message `tnai send` delivers
const LEAD_NAMES = {
  claude: 'Claude Code',
  claudecode: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor Agent',
  cursoragent: 'Cursor Agent',
}; // `tnai new`: CLIs that can lead (agent-graph.js LEADS)
const READ_MAX = 200; // most lines `tnai read` returns
const READ_TAIL = 64 * 1024; // scrollback characters `tnai read` cleans first
const WORKING_MS = 2500; // output this recent = working (same rule as the pane status in 10)

// Told to every agent: Claude Code in its system prompt, Codex/OpenCode/Cursor Agent in their
// instructions (agent-hooks.js WORK_RULES), and all of them in TNAI_AGENTS_HINT.
const HINT =
  "Other AI agents (any provider) may be working in this same project inside Technically Not. Stay on the user's chosen CLI and model: never hand work to or start an agent of a different CLI (Claude Code, Codex, Cursor, OpenCode…) unless the user's prompt asks for that CLI by name. From your shell: `tnai agents` lists them, `tnai send NAME message` types a message into one of them (a working Claude Code agent reads it after its next step, not interrupted; `tnai send --later NAME message` when it can wait until its task ends; use the agent id when names repeat; a closed agent is revived with its conversation, which keeps the tools it started with), `tnai intervene NAME message` stops a working agent where it is and hands it the message at once (urgent only: `tnai send` waits behind its task), `tnai new claude|codex|opencode|cursor TASK` starts a fresh agent in a new panel with the task (it can have its own sub-agents; use it when the user asks for a new agent, and start your own CLI: a different one only when the user's prompt names it; when the user names a model or effort for it, put --model NAME --effort LEVEL before TASK; when the user names the agent itself, --name NAME), `tnai read NAME` shows its recent output, `tnai ask NAME QUESTION` sends a question and waits for its answer (up to 5 min; `--wait SEC`), `tnai context [TOPIC]` shows what other agents finished, `tnai rename NAME` renames your own panel when the user asks you to rename yourself (when they leave the name to you: one or two words that say what you work on), `tnai close --self` closes your own panel only when the user tells you to close or exit yourself, or to close your panel (end your reply first, it closes a moment later); told only to stop, pause or summarize, you end your work, give the summary and stay open, `tnai close NAME...` closes offline or idle agents that are no longer needed, all in one call (`--quiet-over MIN` adds every one quiet that long; add `--user` when the user asked, so agents the user started close too; their finished work stays in `tnai context`), `tnai skill save DIR` saves a reusable procedure you learned (a folder with SKILL.md) to Technically Not's skill library (`tnai skill list` first, to avoid duplicates), `tnai preview URL [phone|tablet|desktop]` shows a running localhost dev server to the user in Technically Not's Live preview (`tnai preview close` closes the tab you opened once you stop its server), `tnai shot preview [URL] [phone|tablet|desktop]` saves a PNG of that page (taken in a hidden window; what the user sees does not change) and prints its path, so you can look at the UI you built, `tnai server list` / `tnai server claim URL` show and record which agent owns each localhost dev server, `tnai test [COMMAND]` runs the project's tests one agent at a time on this computer (prints pass/fail and only the failing part), `tnai tasks` is the project's shared to-do board (`add TEXT`, `take ID`, `release ID`, `done ID`).";

// Arguments that make a CLI do a one-off job instead of an interactive session: such runs pass
// through unchanged and are not registered.
const ONE_OFF = {
  'Claude Code': {
    flags: ['-p', '--print', '-v', '--version', '-h', '--help'],
    subs: [
      'mcp',
      'config',
      'auth',
      'doctor',
      'update',
      'upgrade',
      'install',
      'migrate-installer',
      'setup-token',
      'plugin',
      'plugins',
      'login',
      'logout',
    ],
  },
  Codex: {
    flags: ['-V', '--version', '-h', '--help'],
    subs: [
      'exec',
      'e',
      'login',
      'logout',
      'mcp',
      'mcp-server',
      'app-server',
      'completion',
      'sandbox',
      'debug',
      'apply',
      'a',
      'cloud',
      'proto',
      'help',
      'features',
      'agents',
      'review',
      'plugin',
      'remote-control',
      'app',
      'update',
      'doctor',
      'queue',
      'archive',
      'unarchive',
      'delete',
      'migrate-rollouts',
      'exec-server',
    ],
  }, // codex-cli 0.160.1 `--help`; `resume` and `fork` open a session and stay registered
  'Cursor Agent': {
    flags: ['-p', '--print', '-v', '--version', '-h', '--help'],
    subs: [
      'login',
      'logout',
      'status',
      'whoami',
      'mcp',
      'update',
      'upgrade',
      'ls',
      'create-chat',
      'install-shell-integration',
      'uninstall-shell-integration',
      'help',
    ],
  },
  OpenCode: {
    flags: ['-v', '--version', '-h', '--help'],
    subs: [
      'run',
      'auth',
      'providers',
      'serve',
      'web',
      'acp',
      'mcp',
      'agent',
      'upgrade',
      'uninstall',
      'models',
      'stats',
      'export',
      'import',
      'github',
      'pr',
      'session',
      'debug',
      'completion',
      'generate',
      'plugin',
      'plug',
      'db',
      'attach',
    ],
  },
  // Gemini CLI 0.62, Copilot CLI 1.0.8x and Antigravity 1.2.14 (`--help` on this PC, 2026-09-30);
  // Droid is not installed here, so only the usual flags and `exec` (Factory docs, unchecked).
  'Gemini CLI': {
    flags: [
      '-p',
      '--prompt',
      '-v',
      '--version',
      '-h',
      '--help',
      '-l',
      '--list-extensions',
      '--list-sessions',
      '--delete-session',
    ],
    subs: ['mcp', 'extensions', 'extension', 'skills', 'skill', 'hooks', 'hook', 'gemma'],
  },
  'GitHub Copilot': {
    flags: ['-p', '--prompt', '-v', '--version', '-h', '--help'],
    subs: [
      'app',
      'login',
      'help',
      'init',
      'update',
      'version',
      'workflow',
      'sessions',
      'memories',
      'plugin',
      'mcp',
      'skill',
      'instruction',
      'lsp',
      'completion',
    ],
  },
  Droid: { flags: ['-v', '--version', '-h', '--help'], subs: ['exec', 'update'] },
  Antigravity: {
    flags: ['-p', '--print', '--prompt', '-h', '--help', '--version'],
    subs: [
      'agent',
      'agents',
      'changelog',
      'help',
      'install',
      'mcp',
      'mic-serve',
      'models',
      'plugin',
      'plugins',
      'remote-control',
      'update',
    ],
  },
};

// Claude Code flags Technically Not would add itself; when the user passed one, the session
// registers without Technically Not's additions rather than clash.
const CLAUDE_OWN = [
  '--settings',
  '--mcp-config',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--strict-mcp-config',
];

// Codex takes one profile; Technically Not's rules come as `-p tnai`
const CODEX_OWN = ['-p', '--profile'];

// paneId -> { token, base, home, hand: null | { id, agent, cwd, project, startedAt, pid } }
const panes = new Map();
const tokens = new Map(); // token -> paneId
const renamed = new Map(); // paneId -> { from, to }: a rename its agent has not been told about yet
const renamedAt = new Map(),
  RENAME_GAP_MS = 60000; // paneId -> when its agent last sent a `tnai rename` (the limit there)

// Renames, so the whole app follows a new name (the whole system should know the new
// name at once). An old name keeps reaching the renamed agent (find),
// and every other agent is told once, with its next prompt (renamedNote).
const formerNames = new Map(); // old name, lower case -> { paneId, from, to }
const renameLog = []; // { paneId, from, to, at }, oldest first, the last RENAME_LOG_MAX
const RENAME_LOG_MAX = 50;

// paneId -> the number of the last rename it was told of (renameCount)
const toldRenames = new Map();
let renameCount = 0; // counts every rename, so "after" never depends on two clocks agreeing

// paneId -> { name, task, agent, offline, idle, kept, cwd } published by the UI (37)
const names = new Map();
let server = null,
  port = 0,
  seq = 0,
  send = () => {},
  deps = null;

const shimDir = () => path.join(app.getPath('userData'), 'agent-shims');
const slash = p => String(p).replace(/\\/g, '/');
const norm = p => path.resolve(p).toLowerCase();
const inside = (dir, root) => {
  if (!dir || !root) return false;
  const rel = path.relative(norm(root), norm(dir));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
};
const clean = (text, max) =>
  String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .slice(0, max);
const label = text => clean(text, 80).replace(/\n/g, ' ').trim();

// A sentence the window answers an agent with ("where" it showed a preview, why it refused): one
// line, long enough for 31's longest answer and a list of closed addresses. `label`'s 80 cut it
// mid-word ("…so the preview w.", bug sweep 2026-10-28 item 13).
const sentence = text => clean(text, 600).replace(/\n/g, ' ').trim();

// The shims: one .cmd per agent command and for `tnai` (PowerShell, cmd, Codex's shell), plus a
// `tnai` sh script for Git Bash (Claude Code's Bash tool); on mac/Linux one executable sh script
// per name instead.
function writeShims() {
  // which program runs the stand-ins: the shipped Node runtime when the build has one, else the
  // app itself as Node, exactly as before (node-helper.js)
  const helper = nodeHelper();
  const dir = shimDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'tnai-shim.js'),
    fs.readFileSync(path.join(__dirname, 'agent-shim.js'))
  );
  if (process.platform !== 'win32') {
    // mac/Linux: one executable sh script per agent command and for `tnai`
    for (const name of [...Object.keys(SHIMS), 'tnai']) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, shShim(name, helper), { mode: 0o755 });
      fs.chmodSync(file, 0o755); // a file that already existed keeps its old mode on write
    }

    // A terminal panel's bash starts with this instead of `-l` (pty-service.js): the login files
    // `bash -l` reads, then this folder first on PATH again.
    fs.writeFileSync(
      path.join(dir, 'tnai-bashrc'),
      [
        '# Technically Not: login files as `bash -l` reads them, then the agent shims first on PATH (user rc files may prepend ~/.local/bin).',
        '[ -f /etc/profile ] && . /etc/profile',
        'if [ -f ~/.bash_profile ]; then . ~/.bash_profile; elif [ -f ~/.bash_login ]; then . ~/.bash_login; elif [ -f ~/.profile ]; then . ~/.profile; fi',
        '[ -n "$TNAI_SHIM" ] && PATH="${TNAI_SHIM%/*}:$PATH"',
        '',
      ].join('\n')
    );

    // zsh has no --rcfile: a panel's zsh gets ZDOTDIR=<this folder>/tnai-zsh (pty-service.js). Each
    // file runs the user's own file of the same name from their ZDOTDIR (or ~), then points ZDOTDIR
    // back here for the next one; .zlogin (read last by a login shell) restores the user's ZDOTDIR
    // and puts the shim folder first again.
    const zdir = path.join(dir, 'tnai-zsh');
    fs.mkdirSync(zdir, { recursive: true });
    const zsrc = n => [
      '_tnai_z="$ZDOTDIR"; ZDOTDIR="${TNAI_USER_ZDOTDIR:-$HOME}"',
      `[ -f "$ZDOTDIR/${n}" ] && . "$ZDOTDIR/${n}"`,
    ];
    for (const n of ['.zshenv', '.zprofile', '.zshrc'])
      fs.writeFileSync(
        path.join(zdir, n),
        [
          '# Technically Not: runs your own ' + n + ', then keeps the agent shims first on PATH.',
          ...zsrc(n),
          ...(n === '.zshenv' ? ['TNAI_USER_ZDOTDIR="$ZDOTDIR"'] : []),
          'ZDOTDIR="$_tnai_z"',
          '',
        ].join('\n')
      );
    fs.writeFileSync(
      path.join(zdir, '.zlogin'),
      [
        '# Technically Not: runs your own .zlogin, then keeps the agent shims first on PATH.',
        ...zsrc('.zlogin'),
        'unset _tnai_z',
        '[ -n "$TNAI_SHIM" ] && PATH="${TNAI_SHIM%/*}:$PATH"',
        '',
      ].join('\n')
    );
    return;
  }
  for (const name of [...Object.keys(SHIMS), 'tnai']) {
    fs.writeFileSync(path.join(dir, name + '.cmd'), cmdShim(name, helper));
  }
  fs.writeFileSync(path.join(dir, 'tnai'), shShim('tnai', helper, { gitBash: true }));
}

function listen() {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = net.createServer(onSocket);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
}

// Called by pty:start (main.js) before a pane's process starts: a fresh token (the old one stops
// working) and a function that adds the env / PATH.
async function prepare(paneId, cwd, home) {
  await listen();
  const old = panes.get(paneId);
  if (old) tokens.delete(old.token);
  const token = crypto.randomBytes(16).toString('hex');
  tokens.set(token, paneId);
  panes.set(paneId, { token, base: cwd || home || '', home: home || '', hand: null });
  if (old?.hand) changed();

  // A pane in a Technically Not worktree (a lane) gets its own free port for its dev server, so it
  // never collides with the project folder's or another lane's.
  const previewPort =
    cwd && home && norm(cwd) !== norm(home) && worktrees().known(cwd) ? await freePort() : 0;
  return env => {
    const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
    env[key] = shimDir() + path.delimiter + (env[key] || '');
    const helper = nodeHelper();
    Object.assign(env, {
      TNAI_PANE_TOKEN: token,
      TNAI_MESH_PORT: String(port),
      TNAI_NODE: slash(helper.exe),
      TNAI_SHIM: slash(path.join(shimDir(), 'tnai-shim.js')),
      TNAI_AGENTS_HINT: HINT,

      // TNAI_RUNTIME, with a shipped runtime: where a .cmd stand-in finds it when the install
      // path holds a letter that cannot be written into a .cmd file (node-helper.js cmdShim)
      ...runtimeEnv(helper),
    });
    if (previewPort) env.TNAI_PREVIEW_PORT = String(previewPort);
  };
}
const worktrees = () => deps?.worktrees || require('./worktree-service');

// A port nothing listens on now (the OS picks it, no scanning): the server is closed at once, so
// the lane's dev server can take it.
const freePort = () =>
  new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(0));
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

// The worktree branch a pane works in ('' = the project folder).
const laneOf = paneId => {
  try {
    return worktrees().forPane(paneId)?.branch || '';
  } catch {
    return '';
  }
};

// The open project a folder belongs to ('' = none: not connected). A pane's own worktree counts as
// the project it was started from. roots: the open projects when the caller already has them
// (members() resolves them once, not once per pane: each call stats every project folder).
async function projectOf(pane, dir, roots) {
  roots = roots || (await deps.projects());
  const hit = roots.filter(root => inside(dir, root)).sort((a, b) => b.length - a.length)[0];
  if (hit) return hit;
  return pane && pane.home && inside(dir, pane.base) && roots.some(r => norm(r) === norm(pane.home))
    ? pane.home
    : '';
}

// Live agent sessions: Technically Not-started agent panes and agent CLIs started by hand in a
// terminal pane.
async function members() {
  const running = new Map(
    deps.ptys
      .list()
      .filter(s => s.running)
      .map(s => [s.paneId, s])
  );
  const out = [],
    roots = await deps.projects();
  for (const [paneId, pane] of panes) {
    const s = running.get(paneId);
    if (!s) continue;
    let provider, project;
    if (pane.hand) {
      provider = pane.hand.agent;
      project = pane.hand.project;
    } else if (s.agent !== 'Terminal' && s.mode === 'run') {
      provider = s.agent;
      project = await projectOf(pane, pane.base, roots);
    } else continue;
    out.push({
      paneId,
      provider,
      project,
      hand: !!pane.hand,
      startedAt: pane.hand?.startedAt || s.startedAt,
      pid: s.pid,
      status: Date.now() - (s.lastOutputAt || 0) < WORKING_MS ? 'working' : 'waiting',
      name: names.get(paneId)?.name || paneId,
      task: names.get(paneId)?.task || '',
    });
  }
  return out;
}

// The project a caller acts in: its own session's project, else (a plain terminal) the folder it
// runs in.
async function callerProject(paneId, pane, cwd) {
  if (pane.hand) return pane.hand.project;
  const s = deps.ptys.list().find(x => x.paneId === paneId && x.running);
  if (s && s.agent !== 'Terminal') return projectOf(pane, pane.base);
  return projectOf(pane, typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : pane.base);
}

// `tnai preview URL [phone|tablet|desktop|auto]`: an agent shows what it built to the user in Live
// preview (31), in the device view that fits the project. Same address rule as 31's localUrl
// (http(s) on this computer only). The server must already answer; the renderer says whether it
// showed it (previewShown).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEVICES = { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop' };
const MOBILE_DEPS =
  /^(react-native|expo|@capacitor\/core|@ionic\/(core|react|angular|vue)|cordova|@nativescript\/core|framework7|onsenui)$/;
const previews = new Map(); // request id -> resolve(renderer answer)

function localUrl(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'http://' + text;
  try {
    const url = new URL(text);
    if (
      !/^https?:$/.test(url.protocol) ||
      !LOCAL_HOSTS.has(url.hostname) ||
      url.username ||
      url.password
    )
      return '';
    if (url.hostname === '[::1]') url.hostname = 'localhost';
    return url.href;
  } catch {
    return '';
  }
}

// Device view from the project's own package.json (the nearest one from the caller's folder up to
// the project): a mobile app framework -> Phone, else Desktop.
function deviceFor(project, cwd) {
  let dir =
    typeof cwd === 'string' && path.isAbsolute(cwd) && inside(cwd, project)
      ? path.resolve(cwd)
      : project;
  for (;;) {
    let pkg = null;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {}
    if (pkg) {
      const deps = Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      });
      const mobile = deps.find(d => MOBILE_DEPS.test(d));
      if (mobile)
        return {
          device: 'phone',
          why: 'picked from package.json: ' + mobile + ' is a mobile app framework',
        };
      if (deps.includes('electron'))
        return {
          device: 'desktop',
          why: 'picked from package.json: an Electron app, only its web page shows here, not its own window',
        };
      return { device: 'desktop', why: 'picked from package.json: no mobile app framework' };
    }
    if (norm(dir) === norm(project) || path.dirname(dir) === dir)
      return { device: 'desktop', why: 'no package.json found, so the default' };
    dir = path.dirname(dir);
  }
}

// True when something accepts connections at the URL's host and port (the dev server is up).
function answers(url) {
  const u = new URL(url),
    port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  return new Promise(resolve => {
    const socket = net.connect({ host: u.hostname, port, autoSelectFamily: true });
    const done = ok => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

// `tnai preview close [URL]`: closes the Live preview tab(s) this agent's panel opened (31 matches
// byPane), all of them or the one at URL; never tabs the user or another agent opened.
async function previewClose(paneId, project, msg) {
  const url = msg.url ? localUrl(clean(msg.url, 2000)) : '';
  if (msg.url && !url)
    return errors.fail(
      'invalid',
      'Live preview shows addresses on this computer only: http://localhost:PORT, 127.0.0.1 or [::1].',
      'tnai preview close http://localhost:PORT'
    );
  const id = crypto.randomBytes(8).toString('hex');
  const reply = new Promise(resolve => {
    previews.set(id, resolve);
    setTimeout(() => {
      if (previews.delete(id))
        resolve(errors.fail('unreachable', "Technically Not's window did not answer.", TRY.again));
    }, 6000);
  });
  send('preview:show', { id, close: true, url, project, paneId });
  const r = await reply;
  if (!r.ok) return errors.pass({ ...r, error: 'Not closed: ' + r.error }, 'refused');
  return { ok: true, text: "Closed in Technically Not's Live preview: " + r.where + '.' };
}

async function preview(paneId, project, msg, file = null) {
  if (msg.close === true) return previewClose(paneId, project, msg);
  const url = localUrl(clean(msg.url, 2000));
  if (!url)
    return errors.fail(
      'invalid',
      'Live preview shows addresses on this computer only: http://localhost:PORT, 127.0.0.1 or [::1].',
      'tnai preview http://localhost:PORT [phone|tablet|desktop]'
    );
  const asked = label(msg.device).toLowerCase();
  if (asked && asked !== 'auto' && !DEVICES[asked])
    return errors.fail(
      'invalid',
      'The device view must be phone, tablet, desktop or auto.',
      'tnai preview URL phone|tablet|desktop|auto'
    );
  const pick =
    asked && asked !== 'auto'
      ? { device: asked, why: 'chosen by the agent' }
      : deviceFor(project, msg.cwd);
  if (!(await answers(url)))
    return errors.fail(
      'unreachable',
      'Nothing answers at ' +
        url +
        '. Start the dev server first (in the background, so your shell stays free) and run this again.',
      TRY.devServer
    );
  const id = crypto.randomBytes(8).toString('hex');
  const reply = new Promise(resolve => {
    previews.set(id, resolve);
    setTimeout(() => {
      if (previews.delete(id))
        resolve(errors.fail('unreachable', "Technically Not's window did not answer.", TRY.again));
    }, 6000);
  });

  // a worktree agent's tab is labeled with its ⎇ name (31), so the user knows which copy it shows
  const lane = laneOf(paneId);
  send('preview:show', {
    id,
    url,
    device: pick.device,
    project,
    by: label(names.get(paneId)?.name || ''),
    paneId,
    lane,
    ...(file ? { file: file.rel } : {}),
    // file: a `tnai show` page (31 keeps its tab out of the saved list). paneId: the tab closes
    // with that agent's panel (31)
  });
  const r = await reply;
  if (!r.ok) return errors.pass({ ...r, error: 'Not shown: ' + r.error }, 'refused');
  if (file)
    return {
      ok: true,
      text:
        'Showing ' +
        file.name +
        " to the user in Technically Not's Live preview · " +
        DEVICES[pick.device] +
        ' view' +
        (r.where ? '; ' + r.where : '') +
        '.\n' +
        'Address, for `tnai shot preview` and `tnai preview close`: ' +
        url +
        '\n' +
        'The page is cut off: no other file, no network, no storage, and links do not open. Save the file and the preview reloads.' +
        (file.refs.length
          ? '\nThese will NOT load, put them inside the file (inline CSS and JS, pictures as data: URIs): ' +
            file.refs.join(', ')
          : ''),
    };

  // `tnai server list` shows it with this agent as owner, unless a live agent owns it
  servers.seen(project, paneId, label(names.get(paneId)?.name || paneId), url, p => panes.has(p));
  return {
    ok: true,
    text:
      'Showing ' +
      url +
      " to the user in Technically Not's Live preview · " +
      DEVICES[pick.device] +
      ' view (' +
      pick.why +
      ')' +
      (lane ? ' · tab labeled with your worktree ⎇ ' + lane.replace(/^tnai\//, '') : '') +
      (r.where ? '; ' + r.where : '') +
      '.',
  };
}

// `tnai show FILE.html [device]`: one HTML file inside the project folder or the caller's own
// worktree, served cut off from the app and the network by show-file.js, then shown like any `tnai
// preview` address. It is not a dev server, so `tnai server list` never names it.
async function show(paneId, project, msg) {
  if (!deps.showFile && require('./preview-emulation').unwalled())
    return errors.fail(
      'unreachable',
      'Not shown: Technically Not could not wall the page off right now (its page tools are detached). Restart Technically Not, or serve the file and use tnai preview URL.',
      'serve the file and run tnai preview http://localhost:PORT'
    );
  const made = await (deps.showFile || require('./show-file')).add(clean(msg.file, 1000), msg.cwd, [
    project,
    worktrees().forPane(paneId)?.cwd,
  ]);
  if (!made.ok)
    return errors.pass(
      { ...made, error: 'Not shown: ' + made.error + '.' },
      'invalid',
      'tnai show FILE.html, a file inside this project or your worktree'
    );
  return preview(paneId, project, { url: made.url, device: msg.device, cwd: msg.cwd }, made);
}

// `tnai shot preview [URL] [phone|tablet|desktop]`: a PNG of a localhost page so the agent can look
// at the UI it built. The window only answers which address (default: the tab this agent opened,
// else the active tab) and which viewport (the device asked for, else the Live preview's current
// one); it changes nothing on screen. preview-shot.js loads the page in a hidden window of its own.
// One shot per agent every 2 s.
const SHOT_GAP_MS = 2000;
const lastShot = new Map(); // paneId -> time of its last shot

async function shot(paneId, project, msg) {
  const url = msg.url ? localUrl(clean(msg.url, 2000)) : '';
  if (msg.url && !url)
    return errors.fail(
      'invalid',
      'Screenshots are of addresses on this computer only: http://localhost:PORT, 127.0.0.1 or [::1].',
      'tnai shot preview http://localhost:PORT [phone|tablet|desktop]'
    );
  const asked = label(msg.device).toLowerCase();
  if (asked && !DEVICES[asked])
    return errors.fail(
      'invalid',
      'The device view must be phone, tablet or desktop.',
      'tnai shot preview [URL] phone|tablet|desktop'
    );
  const wait = SHOT_GAP_MS - (Date.now() - (lastShot.get(paneId) || 0));
  if (wait > 0)
    return errors.fail(
      'busy',
      'One screenshot every 2 seconds; wait ' +
        Math.ceil(wait / 1000) +
        ' s and look at the last one first.',
      'look at the last screenshot, then run tnai shot preview again'
    );
  lastShot.set(paneId, Date.now());
  const id = crypto.randomBytes(8).toString('hex');
  const reply = new Promise(resolve => {
    previews.set(id, resolve);
    setTimeout(() => {
      if (previews.delete(id))
        resolve(errors.fail('unreachable', "Technically Not's window did not answer.", TRY.again));
    }, 6000);
  });
  send('preview:show', { id, shot: true, url, device: asked, project, paneId });
  const r = await reply;
  if (!r.ok || !r.shot)
    return errors.pass(
      { ...r, error: 'No screenshot: ' + (r.error || 'the window gave no page') },
      'unreachable',
      'tnai preview http://localhost:PORT first, then tnai shot preview'
    );
  const s = r.shot;
  if (!(await answers(s.url)))
    return errors.fail(
      'unreachable',
      'Nothing answers at ' + s.url + '. Start the dev server first and run this again.',
      TRY.devServer
    );
  let got;
  try {
    got = await (deps.shot || require('./preview-shot')).take({
      url: s.url,
      width: s.w,
      height: s.h,
      preset: s.preset,
    });
  } catch (error) {
    return errors.fail('internal', 'No screenshot: ' + (error?.message || error), TRY.again);
  }
  lastShot.set(paneId, Date.now());
  return {
    ok: true,
    text:
      'Screenshot of ' +
      s.url +
      ' · ' +
      DEVICES[s.device] +
      (s.label ? ' · ' + s.label : '') +
      ' · ' +
      s.w +
      '×' +
      s.h +
      ' viewport' +
      (got.loading ? ' (the page was still loading)' : '') +
      ':\n' +
      got.file +
      '\nImage ' +
      got.width +
      '×' +
      got.height +
      " px, the first screen only (not scrolled). Open the image to look at it. Taken in a hidden window: the user's Live preview did not change.",
  };
}

const changed = () => send('mesh:changed', { at: Date.now() });

function oneOff(agent, args) {
  const rule = ONE_OFF[agent];
  if (!rule) return false;
  const first = args.find(a => !a.startsWith('-'));
  return (
    args.some(a => rule.flags.includes(a.split('=')[0])) ||
    (!!first && args.indexOf(first) === 0 && rule.subs.includes(first))
  );
}

async function launch(paneId, pane, msg, socket) {
  const agent = SHIMS[msg.agent];
  const args =
    Array.isArray(msg.args) &&
    msg.args.length <= 200 &&
    msg.args.every(a => typeof a === 'string' && a.length <= 32768)
      ? msg.args
      : null;
  const s = deps.ptys.list().find(x => x.paneId === paneId && x.running);

  // Registers only in a plain terminal pane with no other hand-started agent (an agent's own tool
  // shell running `claude -p` passes through).
  if (!agent || !args || !s || s.agent !== 'Terminal' || pane.hand || oneOff(agent, args))
    return { ok: true, register: false };
  const cwd =
    typeof msg.cwd === 'string' && path.isAbsolute(msg.cwd) ? path.resolve(msg.cwd) : pane.base;
  const own =
    agent === 'Claude Code'
      ? args.some(a => CLAUDE_OWN.includes(a.split('=')[0]))
      : agent === 'Codex' && args.some(a => CODEX_OWN.includes(a.split('=')[0]));

  // Technically Not's hidden work rules and hooks (agent-hooks.js), plus the library skills turned
  // on for every session (skill-service.js).
  const skills =
    own || !deps.skills ? {} : await deps.skills.launchOptions('', agent).catch(() => ({}));

  // codexHome: the pane's CODEX_HOME, where Codex looks for Technically Not's `-p tnai` profile
  // file (agent-registry.js codexProfile).
  const opts = own
    ? null
    : {
        ...skills,
        ...(await deps.hooks.launchOptions(paneId, agent)),
        codexHome:
          typeof msg.codexHome === 'string' && path.isAbsolute(msg.codexHome) ? msg.codexHome : '',
      };

  // Claude Code's appended system prompt as a file: through this .cmd shim a long argument hits
  // cmd.exe's 8191-char line limit.
  if (opts?.appendPrompt && agent === 'Claude Code')
    opts.appendPromptFile = deps.hooks.promptFile(paneId, opts.appendPrompt);
  const extra = own ? { args: [], env: {} } : deps.registry.handArgs(agent, opts);
  const hand = {
    id: ++seq,
    agent,
    cwd,
    project: await projectOf(pane, cwd),
    startedAt: Date.now(),
    pid: s.pid,
  };

  // raced with another launch or a restart
  if (pane.hand || panes.get(paneId) !== pane) return { ok: true, register: false };

  // The shim gave up waiting and already ran the CLI plainly: its connection is gone, so
  // registering now would never be undone.
  if (socket.destroyed) return { ok: true, register: false };
  pane.hand = hand;

  // Its panel stays a plain terminal: its waits and links end with the CLI (agent-links.js), and so
  // do the messages still held for it (attention-service.js cliEnded), which would otherwise be
  // typed into the shell.
  socket.on('close', () => {
    if (pane.hand === hand) {
      pane.hand = null;
      deps.links?.gone(paneId);
      deps.attention?.cliEnded?.(paneId);
      changed();
    }
  });
  changed();
  return { ok: true, register: true, args: extra.args, env: extra.env };
}

// Agents are addressed by agent id (from `tnai agents`, agent-lifecycle.js) or pane id; by name
// only when exactly one agent here has it (names can repeat). Started by the user (composer New
// agent, custom agent) and so closed only with --user. An agent another agent started with `tnai
// new` is user-owned too (for the delegation tools) but not the user's: agent-lifecycle.js marks it
// startedByAgent.
const userKept = (paneId, n = names.get(paneId)) =>
  !!n?.kept && !deps.lifecycle?.startedByAgent?.(paneId);
const idOf = m => (deps.lifecycle?.instanceOf(m.paneId) || '').slice(0, 8) || m.paneId;

// One helper, two ids: tnai_delegate, tnai_subagents and tnai_wait name a sub-agent by its graph
// id (agent-graph.js), `tnai agents` by its agent id (agent-lifecycle.js). A graph id given to
// send, ask, read, intervene, close or team is turned into the helper's panel id (while its panel
// is open) and agent id (also after it closed), so the id a lead was given reaches its helper.
// Returns null for anything that is not a graph id. Learned 2026-10-28: leads messaged their
// helpers by the given id and reached nobody.
function helperIds(key) {
  const node = deps?.graph?.nodeById?.(label(key));
  if (!node) return null;
  const agentId =
    (node.paneId && deps.lifecycle?.instanceOf(node.paneId)) ||
    deps.lifecycle?.instanceOfContext?.(node.sessionId) ||
    '';
  return { paneId: node.paneId, agentId };
}

// An agent that is not running (closed, hidden), by name or agent id, also by its graph id
const lookupAgent = (key, project) =>
  deps.lifecycle?.lookup(helperIds(key)?.agentId || key, project);

// ", waiting on NAME" for an agent with an unanswered question to another agent (agent-links.js),
// so no agent wonders why it sits idle.
const waitingOn = paneId => {
  const on = deps.links?.of(paneId).waitsOn || [];
  return on.length ? ', waiting on ' + on.map(p => names.get(p)?.name || p).join(', ') : '';
};

// The agents of a project as `tnai agents` lists them (also agent-peers.js: the live team other
// agents are told about).
const rows = (list, project, paneId) =>
  list
    .filter(m => m.project === project)
    .map(m => ({
      name: m.name,
      id: idOf(m),
      provider: m.provider,
      pane: m.paneId,
      status:
        (names.get(m.paneId)?.onAgents
          ? 'waiting on agents'
          : names.get(m.paneId)?.background
            ? 'working in background'
            : m.status) + waitingOn(m.paneId),
      quietMin:
        names.get(m.paneId)?.idle && names.get(m.paneId)?.quietSince
          ? Math.floor((Date.now() - names.get(m.paneId).quietSince) / 60000)
          : null,
      userStarted: userKept(m.paneId),
      task: m.task,
      you: m.paneId === paneId,
      startedBy: m.hand ? 'terminal' : 'Technically Not',
    }));

async function find(list, key, project, self) {
  // a helper named by the id tnai_delegate gave: its panel
  const helper = helperIds(key);
  if (helper?.paneId) key = helper.paneId;
  const k = label(key).toLowerCase(),
    here = list.filter(m => m.project === project && m.paneId !== self);
  const byId = here.find(
    m =>
      m.paneId === key ||
      (k.length >= 6 && (deps.lifecycle?.instanceOf(m.paneId) || '').startsWith(k))
  );
  if (byId) return byId;
  const named = here.filter(m => m.name.toLowerCase() === k);
  if (named.length > 1)
    return {
      code: 'invalid',
      hint: 'the same command with the agent id instead of the name (tnai agents shows them)',
      error:
        'Several agents here are named ' +
        label(key) +
        ': ' +
        named.map(m => m.name + ' (agent id ' + idOf(m) + ')').join(', ') +
        '. Use the agent id.',
    };
  if (named[0]) return named[0];

  // An old name of an agent the user renamed still reaches it, while no agent here carries that
  // name now. The copy says which name was used, so the reply can tell the sender the new one.
  const was = formerNames.get(k);
  const renamedOne = was && here.find(m => m.paneId === was.paneId);
  return renamedOne ? { ...renamedOne, renamedFrom: was.from } : null;
}

// `tnai send Maya 2 check the build` reaches "Maya 2", not "Maya" with the text "2 check the
// build" (app-3 #6). The shell splits an unquoted name into words, so the name is the longest run
// of leading words (at most NAME_WORDS) that names an agent here, running or closed. A typed name
// that holds a space was quoted and is taken as typed. When the first word alone names an agent as
// well, nothing says which one was meant: the command is refused with both names. Returns
// { to, text }, { error }, or null to leave the command as it is.
const NAME_WORDS = 5;

async function nameWithSpaces(list, msg, project, self) {
  if (typeof msg.to !== 'string' || !msg.to || /\s/.test(msg.to)) return null;
  const known = async name =>
    !!(await find(list, name, project, self)) || !!lookupAgent(name, project);
  let name = msg.to,
    rest = msg.text,
    longer = null;
  for (let words = 1; words < NAME_WORDS; words++) {
    // the next word, with more text after it on the same line
    const next = /^[ \t]*(\S+)[ \t]+(?=\S)/.exec(rest);
    if (!next) break;
    name += ' ' + next[1];
    rest = rest.slice(next[0].length);
    if (await known(name)) longer = { to: name, text: rest };
  }
  if (!longer) return null;
  if (await known(msg.to))
    return {
      error:
        'Two agents here match: ' +
        label(msg.to) +
        ' and ' +
        label(longer.to) +
        '. Use the agent id instead of the name (tnai agents shows them), or put a name with spaces in quotes.',
    };
  return longer;
}

// Only the first line of an agent's message carries its true sender ("[from NAME] …"). A further
// line that starts like an app notice or a new task ("[from Technically Not] …", "[TN.ai] New task
// …") is marked as quoted with "> ", so it cannot read as the app's or a lead's own words
// (app-3 #7). Control characters are taken out first, as clean() does later, so none can hide such
// a line.
const NOTICE_LINE = /\n([ \t]*)(?=\[(?:from |TN\.ai\]|TechnicallyNot\.ai\]))/gi;
const quoteNoticeLines = text =>
  String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(NOTICE_LINE, '\n$1> ');

// ---------- renames ----------
const sameFolder = (a, b) =>
  !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// A panel's name changed from `from` to `to`: its old name points at it from now on, and the
// rename waits in the log for every other agent of its project.
function noteRename(paneId, from, to) {
  formerNames.delete(to.toLowerCase());
  formerNames.set(from.toLowerCase(), { paneId, from, to });
  renameLog.push({
    paneId,
    from,
    to,
    seq: ++renameCount,
    at: Date.now(),
    cwd: names.get(paneId)?.cwd || '',
  });
  if (renameLog.length > RENAME_LOG_MAX) renameLog.splice(0, renameLog.length - RENAME_LOG_MAX);
}

// The renamed agent itself: one line, once.
function ownRenameNote(paneId) {
  const r = renamed.get(paneId);
  if (!r) return '';
  renamed.delete(paneId);
  if (r.from === r.to) return '';
  return (
    'Technically Not: the user renamed you from "' +
    r.from +
    '" to "' +
    r.to +
    '". You are ' +
    r.to +
    ' from now on: use that name whenever you name yourself (messages to other agents, hand-offs, reports), and never sign as ' +
    r.from +
    ' again.'
  );
}

// Every other agent of the same project: the renames since it was last told, one line, once.
// A name renamed twice is told as its first old name and its newest name.
function othersRenamedNote(paneId) {
  const since = toldRenames.get(paneId);
  toldRenames.set(paneId, renameCount);
  const cwd = names.get(paneId)?.cwd || '';
  if (since === undefined || !cwd) return '';
  const byPane = new Map();
  for (const r of renameLog) {
    if (r.seq <= since || r.paneId === paneId || !sameFolder(r.cwd, cwd)) continue;
    const seen = byPane.get(r.paneId);
    byPane.set(r.paneId, { from: seen ? seen.from : r.from, to: r.to });
  }
  const changes = [...byPane.values()].filter(r => r.from.toLowerCase() !== r.to.toLowerCase());
  if (!changes.length) return '';
  return (
    'Technically Not: the user renamed ' +
    (changes.length > 1 ? 'agents' : 'an agent') +
    ' in this project: ' +
    changes.map(r => '"' + r.from + '" is now "' + r.to + '"').join(', ') +
    '. Use the new ' +
    (changes.length > 1 ? 'names' : 'name') +
    ' from now on (in `tnai send`, hand-offs, reports and replies to the user); an old name still reaches the same agent.'
  );
}

// `tnai send` to an agent whose pane was closed (or whose process ended): Technically Not revives
// its conversation, then delivers the message.
async function reviveThenDeliver(hit, body, from, text, senderPane) {
  const r = await deps.lifecycle.revive(hit.instanceId);
  const target = r?.paneId && (await members()).find(m => m.paneId === r.paneId);
  if (!target) {
    deps.hooks.note(senderPane, {
      kind: 'mesh-out',
      to: hit.agent + ' · ' + hit.name,
      text: 'Not delivered: ' + (r?.error || 'it did not come back'),
    });
    return;
  }
  deps.lifecycle.note(target.paneId, { source: 'mesh' });
  const r2 = await deliver(target, body);
  deps.hooks.note(target.paneId, { kind: 'mesh-in', from, text });
  if (!r2.ok)
    deps.hooks.note(senderPane, {
      kind: 'mesh-out',
      to: hit.agent + ' · ' + hit.name,
      text: 'Not delivered: ' + r2.error,
    });
}

// `tnai new AGENT task`: Technically Not opens a fresh agent (lifecycle.spawn), then delivers the
// task.
async function spawnThenDeliver(agent, body, from, text, senderPane, pick = null, name = '') {
  const r = await deps.lifecycle.spawn(agent, pick, name);
  const target = r?.paneId && (await members()).find(m => m.paneId === r.paneId);
  if (!target) {
    deps.hooks.note(senderPane, {
      kind: 'mesh-out',
      to: agent,
      text: 'Not started: ' + (r?.error || 'it did not come up'),
    });
    return;
  }
  deps.lifecycle.note(target.paneId, { source: 'mesh' });
  const r2 = await deliver(target, body);
  deps.hooks.note(target.paneId, { kind: 'mesh-in', from, text });
  deps.hooks.note(senderPane, {
    kind: 'mesh-out',
    to: agent + ' · ' + target.name,
    text: r2.ok ? text : 'Not delivered: ' + r2.error,
  });
}

// Agent panes the UI shows with no process (37 publishes them): left over from the last Technically
// Not session, or stopped.
async function offlineIn(project) {
  const out = [],
    roots = await deps.projects();
  for (const [paneId, n] of names)
    if (
      n.offline &&
      (!n.cwd || norm((await projectOf(panes.get(paneId), n.cwd, roots)) || '.') === norm(project))
    )
      out.push({ paneId, ...n });
  return out;
}
const others = (list, project, self) =>
  list
    .filter(m => m.project === project && m.paneId !== self)
    .map(m => m.name)
    .join(', ') || 'none';

// Types the message into the target's input and presses Enter (prompt-submit.js), and says whether
// the CLI took it. With `held` ({ from, onDone }) a message for an input that holds the user's
// unsent text is not typed in (it would merge into it): attention-service.js holds it and onDone
// reports.
function deliver(target, body, held = null) {
  return deps.submit(target.paneId, body, {
    agent: target.provider,
    ...(held ? { holdIfDraft: held } : {}),
  });
}
const DELIVERED = {
  sent: 'It started it',
  queued: 'It is busy; the message waits in its queue and runs after its current task',
  unconfirmed: 'Enter was pressed; this CLI gives no sign it started it, check with `tnai read`',
};

// ---------- `tnai agent`: custom agents, read and proposed (agent-proposals.js) ----------

const DRAFT_HELP =
  'Write a draft file (.md: frontmatter `name`, `cli`, `skills` (comma list), `scope` (project | personal), or `edit: NAME` with `addSkills` / `removeSkills`; the role as its body, at most 300 characters) and run `tnai agent save FILE`.';

const skillNames = ids => (ids.length ? ids.map(id => path.basename(id)).join(', ') : 'none');

function agentRow(a) {
  return (
    '  ' +
    a.name +
    '  ·  ' +
    a.base +
    '  ·  ' +
    a.scope +
    '  ·  skills: ' +
    skillNames(a.skillIds) +
    '  ·  ' +
    (clean(a.role || '-', 400)
      .replace(/\s+/g, ' ')
      .slice(0, 100) || '-')
  );
}

function proposalRow(p) {
  return (
    '  ' +
    p.id +
    '  ·  ' +
    p.state +
    '  ·  ' +
    (p.kind === 'new' ? 'new agent “' + p.after.name + '”' : 'change to “' + p.before.name + '”') +
    '  ·  by ' +
    p.by
  );
}

function customAgentCommand(msg, paneId, project) {
  const proposals = deps.proposals;
  if (!deps.skills?.agents || !proposals)
    return errors.fail('unreachable', 'Custom agents are not available.', TRY.again);
  const agents = deps.skills.agents.list();
  const mine = names.get(paneId) || {};

  if (msg.action === 'list') {
    const waiting = proposals.list(project, { settled: true });
    return {
      ok: true,
      text:
        'Custom agents (' +
        agents.length +
        '; project = this project’s .tnai/agents.json, personal = this computer):\n' +
        (agents.length ? agents.map(agentRow).join('\n') : '  (none)') +
        (waiting.length
          ? '\nProposals (pending ones wait for the user in the bell; settled ones are kept a week):\n' +
            waiting.map(proposalRow).join('\n')
          : '') +
        '\nTo propose a new agent or a change: ' +
        DRAFT_HELP,
    };
  }

  if (msg.action === 'show') {
    const asked = clean(String(msg.name || ''), 200).trim();
    const agent = proposals.findAgent(asked || mine.name || '', agents);
    if (!agent)
      return asked
        ? errors.fail('not_found', 'No custom agent named “' + asked + '”.', 'tnai agent list')
        : {
            ok: true,
            text: 'This panel does not run as a custom agent. `tnai agent list` shows them.',
          };
    const open = proposals.list(project).filter(p => p.targetId === agent.id);
    return {
      ok: true,
      text: [
        agent.name + (asked ? '' : ' (this panel)'),
        'CLI: ' + agent.base + '  ·  kept: ' + agent.scope,
        'Role: ' + (agent.role || '(none)'),
        'Skills: ' +
          skillNames(agent.skillIds) +
          (agent.supportsSkills ? '' : ' (' + agent.base + ' does not load attached skills)'),
        ...open.map(p => 'Waiting for the user: proposal ' + p.id + ' by ' + p.by),
        'To propose a change: ' + DRAFT_HELP.replace('Write', 'write'),
      ].join('\n'),
    };
  }

  if (msg.action !== 'save')
    return errors.fail(
      'invalid',
      'Use `tnai agent list`, `tnai agent show [NAME]` or `tnai agent save FILE`.',
      'tnai agent list'
    );
  try {
    const draft = proposals.readDraft(
      clean(String(msg.path || ''), 1000),
      typeof msg.cwd === 'string' ? msg.cwd : ''
    );
    const { proposal, replaced } = proposals.propose(draft, {
      project,
      by: mine.name || '',
      byCli: mine.agent || '',
    });
    return {
      ok: true,
      text:
        'Proposal ' +
        proposal.id +
        (replaced ? ' (replaces your earlier one)' : '') +
        ' waits for the user in the bell with Accept and Decline; nothing changed yet.\n' +
        proposals
          .describe(proposal)
          .map(line => '  ' + line)
          .join('\n') +
        (proposal.notes.length ? '\nNote: ' + proposal.notes.join(' ') : '') +
        '\nTell the user it waits in the bell. A running copy of the agent picks up an accepted change on its next start.',
    };
  } catch (error) {
    return errors.fail(
      'invalid',
      'Proposal not saved: ' + error.message,
      'fix what it names, then tnai agent save FILE again'
    );
  }
}

async function request(paneId, pane, msg, socket) {
  // The chain of turns a message from another computer's agent started (remote-say.js) comes before
  // everything, a launch included: a CLI started from that agent's own shell runs
  // as it always did from an agent's shell, unregistered.
  const inChain = !!deps.sayTurn?.(paneId);
  if (msg.op === 'launch')
    return inChain ? { ok: true, register: false } : launch(paneId, pane, msg, socket);
  const project = await callerProject(paneId, pane, msg.cwd);
  if (!project)
    return errors.fail(
      'refused',
      'This terminal is not inside an open Technically Not project, so it is not connected to other agents.',
      'cd into the open project folder, then run the command again'
    );

  // A turn that a message from an agent on another computer started (remote-say.js):
  // an allow list, not a deny list. Only the commands that read work in it: `agents`,
  // `read`, `locks`, and plain `tasks` and `context` (with words after them they can write, so
  // those are refused too). Everything else answers the same sentence, the delegation commands
  // included.
  if (
    inChain &&
    !(
      msg.op === 'agents' ||
      msg.op === 'read' ||
      msg.op === 'locks' ||
      ((msg.op === 'tasks' || msg.op === 'context') &&
        !(Array.isArray(msg.args) && msg.args.length))
    )
  )
    return errors.fail(
      'refused',
      'This task came from an agent on another computer, so this command is not available in it. Answer in your final message: it goes back by itself.',
      'answer in your final message'
    );

  // `tnai delegate | wait | subagents | assign` (the user may pick any
  // agent as lead): the same agent-graph.js calls as the tnai_* MCP tools, so a lead whose CLI can
  // run a shell command but can't reach the MCP server can still hand work to sub-agents.
  if (msg.op === 'graph') {
    const tool = {
      delegate: 'tnai_delegate',
      wait: 'tnai_wait',
      subagents: 'tnai_subagents',
      assign: 'tnai_assign',
    }[msg.action];
    if (!tool || !deps.graph)
      return errors.fail('refused', 'Sub-agents are not available here.', 'do the work yourself');
    const stop = new AbortController();
    socket.on('close', () => stop.abort()); // Ctrl+C on `tnai wait` ends the wait
    const r = await deps.graph.call(
      paneId,
      tool,
      msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args : {},
      stop.signal
    );
    const text = (r?.content || []).map(c => c.text).join('\n');
    return r?.isError
      ? errors.fail(r.code || 'refused', errors.withoutLine(text), r.hint)
      : { ok: true, text };
  }

  // `tnai skill save PATH | list` (skill-service.js): an agent saves a procedure it learned to the
  // Skills library, on for every session from the start. `tnai skill overlaps [PATH]` lists skills
  // on the same topic (skill-overlap.js) and `tnai skill remove NAME` drops an agent-written one a
  // merge replaced.
  if (msg.op === 'skill') {
    if (!deps.skills)
      return errors.fail('unreachable', 'The skill library is not available.', TRY.again);
    if (msg.action === 'list') {
      const one = s =>
        '  ' +
        s.name +
        '  ·  ' +
        (s.source === 'imported'
          ? (s.by === 'agent' ? 'library, agent-written' : 'library') +
            (s.everywhere ? ', on' : ', off')
          : s.source) +
        '  ·  ' +
        clean(String(s.description || '-'), 400)
          .replace(/\s+/g, ' ')
          .slice(0, 110);
      const rows = deps.skills.listSkills(project);
      return {
        ok: true,
        text:
          'Skills (' +
          rows.length +
          '; library = Technically Not Skills page, on = loads in every session):\n' +
          rows.map(one).join('\n'),
      };
    }

    // `tnai skill match TEXT` (read-only): which skills the app's own matcher (skill-triggers.js)
    // would name for a sentence the user might say, so an agent in any project can test that a
    // skill it wrote is picked up. Same skills as a real prompt: the project's, and library skills
    // that are on.
    if (msg.action === 'match') {
      const text = clean(String(msg.text || ''), 8000).trim();
      if (!text)
        return errors.fail(
          'invalid',
          'Give the sentence the user would say: `tnai skill match "TEXT"`.',
          'tnai skill match "TEXT"'
        );
      const found = require('./skill-triggers').match(
        text,
        project,
        deps.skills.everywhereSkillFiles?.() || []
      );
      return {
        ok: true,
        text:
          '> ' +
          text +
          '\n' +
          (found.length
            ? found
                .map(
                  s =>
                    '  ' +
                    (s.matched.length >= 2 ? 'match' : 'may match').padEnd(9) +
                    ' ' +
                    s.name +
                    ' (matched: ' +
                    s.matched.join(', ') +
                    ')'
                )
                .join('\n')
            : '  (no skill picked up)') +
          '\nmatch = 2+ keywords, read before starting; may match = one keyword, read only if the description fits. At most 3 skills are named per prompt.',
      };
    }
    const cwd = typeof msg.cwd === 'string' ? msg.cwd : '';
    if (msg.action === 'overlaps') {
      try {
        if (msg.path) {
          const r = deps.skills.overlapsFor(clean(String(msg.path), 1000), cwd, project);
          return {
            ok: true,
            text: r.near.length
              ? r.name +
                ' (' +
                r.scope +
                ') covers the same topic as:\n' +
                r.text +
                '\nMerge them into one skill (write-skills rule) unless you read them and the topics differ.'
              : 'No ' + r.scope + ' skill covers the same topic as ' + r.name + '.',
          };
        }
        const groups = deps.skills.skillOverlaps(project);
        if (!groups.length)
          return {
            ok: true,
            text: "No skills on the same topic in Technically Not's library or this project.",
          };
        return {
          ok: true,
          text:
            'Skills on the same topic (' +
            groups.length +
            ' group' +
            (groups.length > 1 ? 's' : '') +
            '; a match is a candidate: read them and merge only skills that cover one topic):\n' +
            groups
              .map(
                (g, i) =>
                  i +
                  1 +
                  '. ' +
                  (g.scope === 'project' ? 'project' : 'library') +
                  ': ' +
                  g.skills.map(s => s.name).join(', ') +
                  ' — keep the name ' +
                  g.keep +
                  (g.skills.some(s => s.stats.read)
                    ? ' (most read)'
                    : ' (no reads counted yet; the broadest name may fit better)') +
                  '\n' +
                  g.skills
                    .map(
                      s =>
                        '   - ' +
                        s.name +
                        ' (' +
                        s.by +
                        ', ' +
                        s.stats.read +
                        '× read, ' +
                        s.stats.suggested +
                        '× suggested) [' +
                        s.path +
                        ']'
                    )
                    .join('\n') +
                  '\n' +
                  g.pairs.map(p => '   why ' + p.a + ' ~ ' + p.b + ': ' + p.why).join('\n')
              )
              .join('\n'),
        };
      } catch (error) {
        return errors.fail(
          'invalid',
          error.message,
          'tnai skill overlaps (no path), or tnai skill list'
        );
      }
    }
    if (msg.action === 'remove') {
      try {
        const r = deps.skills.removeAgentSkill(clean(String(msg.name || ''), 200));
        return {
          ok: true,
          text:
            'Removed library skill ' +
            r.name +
            '.' +
            (r.everywhere
              ? ' It was on for every session: tell the user, so they can turn the merged skill on from the Skills page.'
              : '') +
            (r.agentIds.length
              ? ' Custom agents that had it: ' +
                r.agentIds.join(', ') +
                ' (give them the merged skill on the Skills page, or tell the user).'
              : ''),
        };
      } catch (error) {
        return errors.fail('not_found', 'Skill not removed: ' + error.message, 'tnai skill list');
      }
    }
    if (msg.action !== 'save')
      return errors.fail(
        'invalid',
        'Use `tnai skill save PATH`, `tnai skill list`, `tnai skill match TEXT`, `tnai skill overlaps [PATH]` or `tnai skill remove NAME`.',
        'tnai skill list'
      );
    try {
      const s = deps.skills.saveAgentSkill(clean(String(msg.path || ''), 1000), cwd, project, {
        distinct: !!msg.distinct,
      });
      return {
        ok: true,
        text:
          (s.replaced ? 'Updated' : 'Saved') +
          ' skill ' +
          s.name +
          ' (id ' +
          s.id +
          ") in Technically Not's skill library: " +
          s.path +
          '\n' +
          (s.everywhere
            ? 'It is on for every session, so new sessions get this version (the user can switch it off on the Skills page).'
            : 'It is off: the user switched it off, and turns it on from the Skills page.') +
          (s.warnings.length ? '\nNote: ' + s.warnings.join(' ') : '') +
          (s.overlaps?.length
            ? '\nSaved as a different topic from: ' + s.overlaps.join(', ') + '.'
            : ''),
      };
    } catch (error) {
      return errors.fail(
        'invalid',
        'Skill not saved: ' + error.message,
        'fix what it names, then tnai skill save PATH again (a folder with SKILL.md, or the SKILL.md file)'
      );
    }
  }

  // `tnai agent list | show [NAME] | save FILE` (agent-proposals.js): an agent reads the user's
  // custom agents and drafts a new one or a change from the user's words. A save is only a
  // proposal: the user accepts or declines it in the bell (60), and nothing changes before that.
  if (msg.op === 'agent') return customAgentCommand(msg, paneId, project);
  const list = await members();
  const me = list.find(m => m.paneId === paneId);

  // A message to another agent: its name may hold spaces (app-3 #6), and its further lines may
  // not pass for the app's or a lead's own words (app-3 #7).
  if (['send', 'ask', 'intervene', 'new'].includes(msg.op) && typeof msg.text === 'string') {
    if (msg.op !== 'new') {
      const named = await nameWithSpaces(list, msg, project, paneId);
      if (named?.error) return errors.fail('invalid', named.error, TRY.agents);
      if (named) Object.assign(msg, named);
    }
    msg.text = quoteNoticeLines(msg.text);
  }

  // `tnai send|ask NAME@COMPUTER …`: an agent on a paired computer.
  // Only this form ever leaves the computer: a bare NAME is
  // always an agent here. A local agent whose own name holds an @ is still found first, as before.
  // Taken only when no agent of this computer, running, offline or closed, has that name, and some
  // paired computer takes messages from this computer's agents for this project.
  // Otherwise the command answers exactly what it always answered.
  if (
    (msg.op === 'send' || msg.op === 'ask') &&
    typeof msg.to === 'string' &&
    msg.to.includes('@') &&
    deps.remoteSay &&
    !(await find(list, msg.to, project, paneId)) &&
    !lookupAgent(msg.to, project)
  ) {
    let takers = [];
    try {
      takers = deps.sayList ? deps.sayList(project) || [] : [];
    } catch {
      takers = [];
    }
    if (takers.length)
      return deps.remoteSay({
        paneId,
        project,
        to: clean(msg.to, 120),
        kind: msg.op,
        text: clean(msg.text, TEXT_MAX + 1),
        wait: msg.wait,
        socket,
        by: { name: label(names.get(paneId)?.name || paneId), cli: me ? me.provider : '' },
      });
  }
  if (msg.op === 'agents') {
    // far: the agents of paired computers that take a message from this computer's agents, for the
    // project open here ([] with connecting off or none that does, and then the command prints
    // exactly what it always printed).
    let far = [];
    try {
      far = deps.sayList ? deps.sayList(project) || [] : [];
    } catch {
      far = [];
    }
    return {
      ok: true,
      project,
      far,
      agents: rows(list, project, paneId),
      offline: (await offlineIn(project)).map(o => ({
        name: o.name,
        agent: o.agent,
        pane: o.paneId,
        task: o.task,
      })),
      closed: deps.lifecycle?.closedIn(project) || [],
    };
  }

  // `tnai clear-closed [--older-than DAYS]` (only when the user asks): removes this project's
  // closed agents from `tnai agents`; open panels are untouched.
  if (msg.op === 'clear-closed') {
    const days = Math.max(0, Number(msg.olderThanDays) || 0);
    const n = deps.lifecycle?.clearClosed(project, days * 864e5) || 0;
    return {
      ok: true,
      text: n
        ? 'Cleared ' +
          n +
          ' closed agent' +
          (n === 1 ? '' : 's') +
          (days ? ' closed ' + days + '+ days ago' : '') +
          ' from the list. They can no longer be revived with `tnai send`; their finished work stays in `tnai context`.'
        : 'No closed agents' + (days ? ' older than ' + days + ' days' : '') + ' to clear.',
    };
  }

  // `tnai rename NAME`: the user asked this agent to rename itself. The window renames its panel
  // like the user's own rename (21 renamePane via 47), so the tree, cards and `tnai agents` follow;
  // 37 then republishes the names, which is how the rename is confirmed here before the agent is
  // told it worked.
  if (msg.op === 'rename') {
    const name = label(msg.name).slice(0, 40),
      old = names.get(paneId)?.name || '';
    if (!name)
      return errors.fail('invalid', 'Give the new name: `tnai rename NAME`.', 'tnai rename NAME');
    if (name === old) return { ok: true, text: 'You are already named ' + name + '.' };
    const taken = [...names].find(
      ([id, n]) => id !== paneId && n.name.toLowerCase() === name.toLowerCase()
    );
    if (taken)
      return errors.fail(
        'invalid',
        'Another agent is already named ' + taken[1].name + '. Choose a different name.',
        'tnai rename OTHER_NAME (tnai agents shows the names taken)'
      );

    // At most one a minute per agent while a paired computer has full control here
    // (deps.renameLimited): the name is part of the ticket that
    // computer's Stop and Interrupt carry, so an agent renaming itself every second stayed out of
    // their reach. Counted from the moment a rename is sent to the window, also one the window then
    // does not apply. The user's own rename of a panel is not counted, and without such a computer
    // nothing is refused.
    const left = RENAME_GAP_MS - (Date.now() - (renamedAt.get(paneId) || 0));
    if (left > 0 && deps.renameLimited?.())
      return {
        ok: false,
        code: 'busy',
        hint: 'wait ' + Math.ceil(left / 1000) + ' s, then tnai rename ' + name,
        error:
          'Not renamed: you renamed yourself less than a minute ago. Wait ' +
          Math.ceil(left / 1000) +
          ' seconds, then run `tnai rename ' +
          name +
          '` again. You are still ' +
          (old || 'unnamed') +
          '.',
      };
    renamedAt.set(paneId, Date.now());
    send('lifecycle:rename', { paneId, name });
    for (let i = 0; i < 20 && names.get(paneId)?.name !== name; i++)
      await new Promise(r => setTimeout(r, 100));
    if (names.get(paneId)?.name !== name)
      return {
        ok: false,
        code: 'refused',
        hint: 'tnai rename OTHER_NAME (tnai agents shows the names taken)',
        error:
          'Technically Not did not apply the name ' +
          name +
          ' (a terminal or a saved custom agent may already have it). You are still ' +
          (old || 'unnamed') +
          '.',
      };
    renamed.delete(paneId); // it renamed itself: it knows
    return {
      ok: true,
      text:
        'Renamed' +
        (old ? ' from ' + old : '') +
        ' to ' +
        name +
        '. Other agents reach you as ' +
        name +
        ' from now on.',
    };
  }

  // `tnai close [--user] [--quiet-over MIN] NAME|ID...`: close agents that aren't needed, several
  // in one call, all at once. On its own judgement an agent may close only offline panes (no
  // process: left over from the last Technically Not session, or stopped) and idle Technically
  // Not-picked agents. With --user (only when the user asked for it) idle or offline agents the
  // user started or set up (New agent, custom agents) and sub-agents qualify too. Never a busy
  // agent, the caller, or a CLI typed by hand into a terminal (closing it would end the user's
  // shell). --quiet-over MIN adds every qualifying agent quiet at least MIN minutes. `tnai close
  // --self`: the user told this agent to close itself. Its panel closes like the user's own Close
  // button (process stopped, conversation and results kept), a moment later so the command's reply
  // still reaches the agent's output.
  if (msg.op === 'close' && msg.self === true) {
    const me = names.get(paneId)?.name || 'This agent';

    // --successor NAME: this agent handed its work over and retires; a later `tnai send` to it goes
    // to that agent instead of reviving it (agent-lifecycle.js retire).
    let heir = null;
    if (msg.successor) {
      heir = await find(list, msg.successor, project, paneId);
      if (heir?.error)
        return errors.pass({ ...heir, error: heir.error + ' Not closed.' }, 'invalid', TRY.agents);
      if (!heir)
        return {
          ok: false,
          code: 'not_found',
          hint: TRY.agents,
          error:
            'No live agent "' +
            label(msg.successor) +
            '" in this project to hand over to. Agents here: ' +
            others(list, project, paneId) +
            '. Not closed.',
        };
      deps.lifecycle?.retire(paneId, heir.paneId);

      // its open questions and links go to the successor too (agent-links.js)
      deps.links?.moved(paneId, heir.paneId);
    }
    setTimeout(() => send('lifecycle:close', { paneId, name: me, reason: 'self' }), 1500);
    return {
      ok: true,
      to:
        'yourself (' +
        me +
        '): your panel closes in a moment. ' +
        (heir
          ? 'You are retired: messages sent to you go to ' +
            heir.name +
            ' from now on, and your finished work stays in `tnai context`'
          : 'Your conversation stays revivable with `tnai send` and your finished work stays in `tnai context`'),
    };
  }
  if (msg.op === 'close') {
    const user = msg.user === true,
      over = Number(msg.quietOver) > 0 ? Number(msg.quietOver) : 0;

    // An agent whose own name has a comma: the shim also sends each word whole (msg.words); a
    // word that is an agent's whole name here stays one name, any other word is split at commas
    const offline = await offlineIn(project);
    const named = word =>
      [...list.filter(m => m.project === project), ...offline].some(
        m => String(m.name || '').toLowerCase() === label(word).toLowerCase()
      );
    const given = Array.isArray(msg.words)
      ? msg.words.flatMap(word => (named(String(word)) ? [String(word)] : String(word).split(',')))
      : Array.isArray(msg.names)
        ? msg.names
        : [msg.to];
    const keys = given.map(label).filter(Boolean).slice(0, 50);
    if (!keys.length && !over)
      return errors.fail(
        'invalid',
        'Name the agents to close, or use --quiet-over MINUTES.',
        'tnai close NAME... or tnai close --quiet-over MINUTES'
      );
    const now = Date.now();
    const idle = list
      .filter(
        m =>
          m.project === project &&
          m.paneId !== paneId &&
          !m.hand &&
          names.get(m.paneId)?.idle &&
          (user || (!userKept(m.paneId) && !deps.lifecycle?.info(m.paneId)?.subagent))
      )
      .map(m => ({
        paneId: m.paneId,
        name: m.name,
        id: idOf(m),
        state: 'idle',
        quiet: names.get(m.paneId)?.quietSince ? now - names.get(m.paneId).quietSince : 0,
      }));
    const pool = [
      ...offline
        .filter(o => o.paneId !== paneId && (user || !userKept(o.paneId, o)))
        .map(o => ({ ...o, id: o.paneId, state: 'offline', quiet: Infinity })),
      ...idle,
    ];
    const picked = new Map(),
      refused = [];
    for (const key of keys) {
      const k = key.toLowerCase();

      // a helper named by the id tnai_delegate gave: its panel
      const helperPane = helperIds(key)?.paneId || '';
      const hits = pool.filter(
        c =>
          c.paneId === key ||
          (!!helperPane && c.paneId === helperPane) ||
          c.name.toLowerCase() === k ||
          (k.length >= 6 && String(c.id).toLowerCase().startsWith(k))
      );
      if (hits.length > 1)
        refused.push(
          'Several agents here are named ' +
            key +
            ': ' +
            hits.map(h => h.name + ' (id ' + h.id + ')').join(', ') +
            '. Use the id.'
        );
      else if (hits.length) picked.set(hits[0].paneId, hits[0]);
      else {
        const m = list.find(
          x =>
            x.project === project &&
            (x.name.toLowerCase() === k ||
              x.paneId === key ||
              (!!helperPane && x.paneId === helperPane) ||
              (k.length >= 6 && String(idOf(x)).toLowerCase().startsWith(k)))
        );
        refused.push(
          !m
            ? 'No agent "' + key + '" in this project.'
            : m.paneId === paneId
              ? key + ' is you.'
              : m.hand
                ? key + ' was typed by hand in a terminal; the user closes that one.'
                : !names.get(m.paneId)?.idle
                  ? key +
                    (deps.attention?.blocker?.(m.paneId)
                      ? ' is stopped on a question for the user (Needs you); it closes once that is answered.'
                      : ' is working right now.')
                  : key +
                    ' was started by the user' +
                    (user ? '' : '; if the user asked to close it, add --user') +
                    '.'
        );
      }
    }
    if (over) for (const c of pool) if (c.quiet >= over * 60000) picked.set(c.paneId, c);
    const from = label(names.get(paneId)?.name || paneId),
      closed = [...picked.values()];
    for (const c of closed)
      send('lifecycle:close', {
        paneId: c.paneId,
        name: c.name,
        reason: user ? 'user' : 'lead',
        by: from,
      });
    const mins = c =>
      c.state === 'offline'
        ? 'offline'
        : 'idle' + (c.quiet ? ', quiet ' + Math.floor(c.quiet / 60000) + ' min' : '');
    const left = pool.filter(c => !picked.has(c.paneId));
    if (!closed.length)
      return {
        ok: false,
        code: 'refused',
        hint: 'close only the agents it names under "Can be closed" (tnai agents shows their state)',
        error:
          (refused.join(' ') || 'No agent here has been quiet ' + over + ' min or more.') +
          ' Can be closed: ' +
          (left.map(c => c.name + ' (' + mins(c) + ')').join(', ') || 'none') +
          '.',
      };
    return {
      ok: true,
      to:
        closed.map(c => c.name + ' (' + mins(c) + ')').join(', ') +
        '. Their conversations stay revivable with `tnai send` and their finished work stays in `tnai context`' +
        (refused.length ? '.\nNot closed: ' + refused.join(' ') : ''),
    };
  }
  if (msg.op === 'new') {
    const agent =
      LEAD_NAMES[
        String(msg.agent || '')
          .toLowerCase()
          .replace(/[\s_-]/g, '')
      ];
    if (!agent)
      return errors.fail(
        'invalid',
        'Unknown agent "' + label(msg.agent) + '". Use claude, codex, opencode or cursor.',
        'tnai new claude|codex|opencode|cursor TASK'
      );

    // The sub-agent limits hold here too (agent-graph.js refuseNew): never from a sub-agent's
    // panel, and only so many open at once.
    const no = deps.lifecycle?.info?.(paneId)?.subagent
      ? 'Refused: a sub-agent does not start new agents. Do the work yourself, or say in your report what else is needed.'
      : deps.graph?.refuseNew?.(paneId, deps.lifecycle?.startedOpen?.() || 0);
    if (no)
      return /^Refused: a sub-agent/.test(no)
        ? errors.fail('refused', no, 'do the work yourself')
        : errors.fail(
            'full',
            no,
            'tnai agents, then tnai send NAME to reuse one or tnai close NAME'
          );
    const text = clean(msg.text, TEXT_MAX + 1).trim();
    if (!text) return errors.fail('invalid', 'Nothing to send.', TRY.send);
    if (text.length > TEXT_MAX)
      return errors.fail(
        'invalid',
        'Message too long (at most ' + TEXT_MAX + ' characters).',
        TRY.short
      );

    // --model / --effort: only names from that CLI's own list (model-pick.js); anything else is
    // refused here, before a panel opens.
    const pick = await require('./model-pick').resolve(
      agent,
      clean(msg.model, 120),
      clean(msg.effort, 40)
    );
    if (pick.error)
      return errors.fail(
        'invalid',
        pick.error,
        'run it again with a model and effort from that list, or without --model and --effort'
      );
    const from = (me ? me.provider : 'Terminal') + ' · ' + label(names.get(paneId)?.name || paneId);

    // --name: the user's own name for it, shown as is
    const name = clean(msg.name, 41).replace(/\s+/g, ' ').trim().slice(0, 40);
    spawnThenDeliver(agent, '[from ' + from + '] ' + text, from, text, paneId, pick, name).catch(
      e =>
        deps.hooks.note(paneId, {
          kind: 'mesh-out',
          to: agent,
          text: 'Not started: ' + (e?.message || e),
        })
    );
    return {
      ok: true,
      to:
        'a new ' +
        agent +
        ' agent' +
        (name ? ' named ' + name : '') +
        (pick.label ? ' on ' + pick.label : '') +
        '. Technically Not is starting it in a new panel, and the task arrives once it is ready' +
        (name ? '' : ' (`tnai agents` shows its name)'),
    };
  }

  // `tnai ask NAME [--wait SEC] question` (agent-ask.js): delivered like `tnai send`, then this
  // command waits for the target's `tnai send` answer.
  if (msg.op === 'ask') {
    const secs = asks.seconds(msg.wait),
      myName = label(names.get(paneId)?.name || paneId);
    const live = await find(list, msg.to, project, paneId);
    if (live?.error) return errors.pass(live, 'invalid', TRY.agents);
    const hit = live ? null : lookupAgent(msg.to, project);
    const heir = hit ? deps.lifecycle.successorOf?.(hit.instanceId) : null;
    const target = {
      panes: [live?.paneId, heir?.paneId],
      instances: [
        live && deps.lifecycle?.instanceOf(live.paneId),
        hit?.instanceId,
        heir?.instanceId,
      ],
    };

    // waiting before the question goes out, so a fast answer is never missed
    const answered = asks.wait(paneId, target, secs, socket);
    const note =
        '\n(Question from `tnai ask`: ' +
        myName +
        ' is waiting. Answer with one `tnai send ' +
        myName +
        ' ANSWER`; it goes straight back to its command.)',
      qText = clean(msg.text, TEXT_MAX + 1).trim();
    if (!qText) {
      asks.cancel(paneId, socket);
      return errors.fail('invalid', 'Nothing to send.', 'tnai ask NAME QUESTION');
    }
    if (qText.length > TEXT_MAX - note.length) {
      asks.cancel(paneId, socket);
      return errors.fail(
        'invalid',
        'Message too long (at most ' + (TEXT_MAX - note.length) + ' characters for a question).',
        TRY.short
      );
    }
    const sent = await request(
      paneId,
      pane,
      { ...msg, op: 'send', asap: true, text: qText + note },
      null
    );
    if (!sent.ok) {
      asks.cancel(paneId, socket);
      return sent;
    }
    const got = await answered;
    if (!got)
      return {
        ok: true,
        text:
          'No answer from ' +
          sent.to.split(' (')[0] +
          ' within ' +
          secs +
          ' s. Its answer will arrive in your input as a normal message; keep working on what does not depend on it.',
      };
    return { ok: true, text: 'Answer from ' + got.from + ':\n' + got.text };
  }

  // `tnai intervene NAME message`: an urgent message must not wait in the
  // target's queue behind its current task. The target is stopped where it is with its CLI's own
  // interrupt key, then handed the message; it decides what to do with it. Not interrupted, the
  // message goes as a normal `tnai send` and the answer says why: a target that is not working, one
  // waiting on a permission or a question for the user (the interrupt key would answer it), one
  // whose input holds the user's unsent text, one that is closed. Refused: a second interrupt of
  // the same agent within INTERVENE_GAP_MS, and interrupting yourself.
  if (msg.op === 'intervene') {
    const text = clean(msg.text, TEXT_MAX + 1).trim();
    if (!text) return errors.fail('invalid', 'Nothing to send.', TRY.send);
    if (text.length > TEXT_MAX)
      return errors.fail(
        'invalid',
        'Message too long (at most ' + TEXT_MAX + ' characters).',
        TRY.short
      );
    const target = await find(list, msg.to, project, paneId);
    if (target?.error) return errors.pass(target, 'invalid', TRY.agents);
    if (
      target?.paneId === paneId ||
      (!target &&
        String(msg.to).toLowerCase() === label(names.get(paneId)?.name || '').toLowerCase()) ||
      msg.to === paneId
    )
      return errors.fail('invalid', 'That is you.', 'tnai agents, then the name of another agent');
    const plain = async why => {
      const r = await request(paneId, pane, { op: 'send', to: msg.to, text }, socket);
      return r.ok
        ? {
            ok: true,
            interrupted: false,
            text:
              'Not interrupted: ' +
              why +
              '. Sent as a normal message instead: ' +
              (r.queued ? 'queued for ' : 'sent to ') +
              r.to +
              '.',
          }
        : r;
    };
    if (!target) return plain('no running agent "' + label(msg.to) + '" to stop');
    const blocked = deps.attention?.blocker?.(target.paneId);
    if (blocked)
      return plain(
        target.name +
          ' is waiting on ' +
          (blocked.kind === 'permission' ? 'a permission prompt' : 'a question') +
          ' for the user, and the interrupt key would answer it'
      );
    if (deps.attention?.hasDraft?.(target.paneId))
      return plain(target.name + ' has unsent text of the user in its input');
    if (names.get(target.paneId)?.idle) return plain(target.name + ' is not working on a task');
    const gap = INTERVENE_GAP_MS - (Date.now() - (intervened.get(target.paneId) || 0));
    if (gap > 0)
      return {
        ok: false,
        code: 'busy',
        hint: 'tnai send ' + target.name + ' MESSAGE (it waits behind its current task)',
        error:
          target.name +
          ' was interrupted by an agent less than ' +
          Math.round(INTERVENE_GAP_MS / 60000) +
          ' min ago. Try again in ' +
          Math.ceil(gap / 1000) +
          ' s, or use `tnai send` (it waits behind its current task).',
      };
    const from = (me ? me.provider : 'Terminal') + ' · ' + label(names.get(paneId)?.name || paneId),
      to = target.provider + ' · ' + target.name;
    intervened.set(target.paneId, Date.now());

    // OpenCode with the link to its own server on (opencode-link.js): its abort call, exact, and no
    // key lands in its input. Real runs 2026-10-06: the screen ends as after Esc Esc ("·
    // interrupted"), the same events, and it takes a new prompt. Every guard above is as before;
    // not taken (no link, no session known, a refused call), the keys below as before.
    const aborted =
      target.provider === 'OpenCode' &&
      (
        await (deps.openCodeLink || require('./opencode-link'))
          .abort(target.paneId)
          .catch(() => null)
      )?.ok === true;
    if (!aborted)
      try {
        deps.ptys.write?.(target.paneId, target.provider === 'Terminal' ? '\x03' : '\x1b');
      } catch {}

    // OpenCode only: one Esc brings up "esc again to interrupt", a second one soon after stops the
    // task (desktop test real-opencode, 1.18.35: 300 ms apart ended it in 434 ms; one alone left it
    // working). Not pressed when the task has ended meanwhile, or a question or the user's text is
    // there now.
    if (target.provider === 'OpenCode' && !aborted) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const working = deps.turns?.busy
        ? deps.turns.busy(target.paneId)
        : !names.get(target.paneId)?.idle;
      if (
        working &&
        !deps.attention?.blocker?.(target.paneId) &&
        !deps.attention?.hasDraft?.(target.paneId)
      )
        try {
          deps.ptys.write?.(target.paneId, '\x1b');
        } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, INTERVENE_SETTLE_MS));

    // Claude Code stopped before the first words of its reply does not pause the task: it puts the
    // task's prompt back into its input and forgets it, so the message would be merged into that
    // prompt (seen with real-intervene, 2026-10-01). agent-turns tells which it was a moment after
    // the key: anything but a real interrupt gets Enter first (starts the put-back task again;
    // nothing on an empty input), then the message, which Claude Code keeps in its own queue and
    // reads during the task.
    if (target.provider === 'Claude Code' && deps.turns?.stopped) {
      let how = '';
      for (
        let waited = 0;
        !(how = deps.turns.stopped(target.paneId)) && waited < INTERVENE_REPLY_MS;
        waited += INTERVENE_CHECK_MS
      )
        await new Promise(resolve => setTimeout(resolve, INTERVENE_CHECK_MS));
      if (how !== 'reply') {
        try {
          deps.ptys.write?.(target.paneId, '\r');
        } catch {}
        await new Promise(resolve => setTimeout(resolve, INTERVENE_SETTLE_MS));
        deps.lifecycle?.note(target.paneId, { source: 'mesh' });
        const r = await deliver(
          target,
          '[from ' +
            from +
            ' · urgent] ' +
            text +
            '\n(Urgent information from another agent, not an order: decide whether it changes what you are doing. Reply only if it asks for something.)'
        );
        if (!r.ok)
          return {
            ok: false,
            code: 'unreachable',
            hint: 'tnai send ' + target.name + ' MESSAGE',
            error:
              target.name +
              ' did not get the message (' +
              (r.error || r.state) +
              '). Send it again with `tnai send`.',
          };
        deps.hooks.note(target.paneId, {
          kind: 'mesh-in',
          from,
          text: 'Interrupted its task: ' + text,
          interrupt: true,
        });
        if (me) deps.hooks.note(paneId, { kind: 'mesh-out', to, text: 'Interrupted: ' + text });
        return {
          ok: true,
          interrupted: false,
          text:
            target.name +
            ' had only just started its task and had written nothing yet, so there was nothing to pause: its task was started again and your message typed into it. It reads it while it works and decides what to do with it.',
        };
      }
    }
    deps.lifecycle?.note(target.paneId, { source: 'mesh' });
    const r = await deliver(
      target,
      '[from ' +
        from +
        ' · interrupted you on purpose] ' +
        text +
        '\n(Another agent stopped your task because it judged this could not wait. It is information, not an order: read it, decide whether it changes what you were doing, then carry on with your task from where you stopped unless it gives you a real reason not to. Reply only if it asks for something.)'
    );
    if (!r.ok) {
      if (me)
        deps.hooks.note(paneId, {
          kind: 'mesh-out',
          to,
          text: 'Interrupted, but not delivered: ' + text,
        });
      return {
        ok: false,
        code: 'unreachable',
        hint: 'tnai send ' + target.name + ' MESSAGE',
        error:
          target.name +
          ' was interrupted, but the message was not delivered (' +
          (r.error || r.state) +
          '). It is stopped without your message: send it again with `tnai send`.',
      };
    }
    deps.hooks.note(target.paneId, {
      kind: 'mesh-in',
      from,
      text: 'Interrupted its task: ' + text,
      interrupt: true,
    });
    if (me) deps.hooks.note(paneId, { kind: 'mesh-out', to, text: 'Interrupted: ' + text });
    return {
      ok: true,
      interrupted: true,
      text:
        'Interrupted ' +
        target.name +
        ' (' +
        target.provider +
        ') and gave it your message. ' +
        (DELIVERED[r.state] || '') +
        '. It decides what to do with it.',
    };
  }
  if (msg.op === 'send') {
    const text = clean(msg.text, TEXT_MAX + 1).trim();
    if (!text) return errors.fail('invalid', 'Nothing to send.', TRY.send);
    if (text.length > TEXT_MAX)
      return errors.fail(
        'invalid',
        'Message too long (at most ' + TEXT_MAX + ' characters).',
        TRY.short
      );
    let target = await find(list, msg.to, project, paneId),
      retired = '',
      hit = null;
    if (target?.error) return errors.pass(target, 'invalid', TRY.agents);
    let from = (me ? me.provider : 'Terminal') + ' · ' + label(names.get(paneId)?.name || paneId);
    if (!target) {
      hit = lookupAgent(msg.to, project);

      // A retired agent (it handed its work over) is not revived: its successor gets the message.
      // Only when no successor can take it is the old one revived, so nothing is lost.
      const heir = hit && deps.lifecycle.successorOf?.(hit.instanceId);
      if (heir && heir.instanceId !== deps.lifecycle.instanceOf(paneId)) {
        const live =
          heir.paneId && list.find(m => m.paneId === heir.paneId && m.project === project);
        if (live || heir.state === 'hidden' || heir.state === 'stopped') {
          retired = hit.name;
          target = live || null;
          if (!live) hit = heir;
        }
      }
      if (retired) from += ', to ' + retired + ', which handed its work to you';
    }
    const via = retired
      ? ', which took over from ' + retired + ' when it retired'
      : target?.renamedFrom
        ? ', which the user renamed from ' + target.renamedFrom + ': use its new name'
        : '';
    if (!target) {
      if (
        hit &&
        (hit.state === 'hidden' || hit.state === 'stopped') &&
        hit.instanceId !== deps.lifecycle.instanceOf(paneId)
      ) {
        const undelivered = e =>
          deps.hooks.note(paneId, {
            kind: 'mesh-out',
            to: hit.agent + ' · ' + hit.name,
            text: 'Not delivered: ' + (e?.message || e),
          });

        // The sender's own sub-agent comes back as its sub-agent (agent-graph.js resend), so its
        // result returns to the sender; any other closed agent is revived the general way.
        const own = retired ? null : deps.graph?.resend?.(paneId, hit.name, text);
        if (own)
          own.then(r => r.ok || undelivered(r.error || 'it did not come back')).catch(undelivered);
        else
          reviveThenDeliver(hit, '[from ' + from + '] ' + text, from, text, paneId).catch(
            undelivered
          );
        if (me)
          deps.hooks.note(paneId, { kind: 'mesh-out', to: hit.agent + ' · ' + hit.name, text });
        return {
          ok: true,
          to:
            hit.name +
            ' (' +
            hit.agent +
            via +
            '). It was closed: Technically Not is reviving its conversation, and the message arrives once it is ready',
        };
      }
      return {
        ok: false,
        code: 'not_found',
        hint: TRY.agents,
        error:
          'No agent "' +
          label(msg.to) +
          '" in this project' +
          (hit ? ' that can still be reached (its conversation was cleared)' : '') +
          '. Agents here: ' +
          others(list, project, paneId) +
          '.',
      };
    }

    // The answer to a waiting `tnai ask` (agent-ask.js) goes straight back to that command, not
    // into the asker's input.
    if (asks.answer(paneId, deps.lifecycle?.instanceOf(paneId), target.paneId, from, text)) {
      if (me) deps.links?.sent(paneId, target.paneId, { text });
      deps.hooks.note(target.paneId, { kind: 'mesh-in', from, text });
      if (me)
        deps.hooks.note(paneId, {
          kind: 'mesh-out',
          to: target.provider + ' · ' + target.name,
          text,
        });
      return {
        ok: true,
        to:
          target.name +
          ' (' +
          target.provider +
          '). It was waiting for this answer (`tnai ask`) and got it at once',
      };
    }
    deps.lifecycle?.note(target.paneId, { source: 'mesh' });
    const to = target.provider + ' · ' + target.name;

    // To the sender's own sub-agent this is more work from its parent: the result comes back to
    // the sender (agent-graph.js sentByParent). Taken back when the message is not delivered. Not
    // for a `tnai ask` question: its answer already goes straight back to the waiting command.
    const mine = msg.asap !== true && !!deps.graph?.sentByParent?.(paneId, target.paneId);
    const body = '[from ' + from + '] ' + text;
    const heldOpts = {
      from,
      asap: msg.asap === true,
      onDone: res => {
        if (mine && !res?.ok) deps.graph.sentByParent(paneId, target.paneId, false);

        // asap: a `tnai ask` question is not held for a working agent
        if (res?.ok) deps.hooks.note(target.paneId, { kind: 'mesh-in', from, text });
        if (me) deps.links?.delivered(paneId, target.paneId, !!res?.ok);
        if (me)
          deps.hooks.note(paneId, {
            kind: 'mesh-out',
            to,
            text: res?.ok
              ? (res.midTask ? 'Read while it worked: ' : 'Delivered after waiting: ') + text
              : 'Not delivered: ' + (res?.error || res?.state || 'it was dropped'),
          });

        // The sender was told "queued" and nothing more, so a held message that is dropped
        // (expired behind the user's unsent text, cancelled, its panel gone) is told to the
        // sender in one line, or it would wait for an answer that never comes.
        if (me && !res?.ok)
          Promise.resolve(
            deps.notify?.(
              paneId,
              '[from Technically Not] Your message to ' +
                target.name +
                ' was not delivered: ' +
                (res?.error || res?.state || 'it was dropped') +
                ' Send it again if it still matters. No reply needed.'
            )
          ).catch(e => console.warn('[tnai] not-delivered notice failed:', e?.message || e));
      },
    };

    // Waits and links (agent-links.js): only between agents, and only for a message that was typed
    // in or queued. A message that closes a ring of waits (the target, or someone it waits on, is
    // waiting on the sender) says so in the sender's own command result: no extra prompt for
    // anyone. `held` is tested first: a message read mid-task is linked before `r` exists.
    const linked = held => {
      const ring =
        me && (held || r.ok)
          ? deps.links?.sent(paneId, target.paneId, {
              ask: msg.asap === true,
              text,
              delivered: !held,
            })?.ring || []
          : [];
      return ring.length
        ? ' Note: ' +
            ring.map(p => names.get(p)?.name || p).join(' and ') +
            (ring.length > 1 ? ' are' : ' is') +
            ' waiting on an answer that leads back to you, so nobody in this ring can go on by waiting. Answer what you were asked, or carry on with what does not depend on the answer.'
        : '';
    };

    // A WORKING Claude Code agent reads another agent's message after its next tool call
    // (agent-notices.js, agent-hooks.js PostToolUse), not interrupted and not left in its prompt
    // queue until the task ends. Not for `tnai send --later` (the sender said it can wait), and not
    // for other CLIs, which have no such step: theirs waits in the queue as before. A message no
    // tool call took within a minute, or still held when the task ends, goes the old way
    // (deliver), so none is lost.
    const working = deps.turns?.busy ? deps.turns.busy(target.paneId) : false;
    const notices = deps.notices;
    if (notices && target.provider === 'Claude Code' && working && msg.later !== true) {
      const fallback = async () => {
        const late = await deliver(target, body, heldOpts);
        if (late.state === 'held') return;
        heldOpts.onDone(late.ok ? { ok: true } : late);
      };
      const onTaken = () => heldOpts.onDone({ ok: true, midTask: true });
      notices.hold(target.paneId, text, fallback, notices.WAIT_MS, { from, onTaken });
      if (me) deps.hooks.note(paneId, { kind: 'mesh-out', to, text: 'Sent mid-task: ' + text });
      return {
        ok: true,
        to:
          target.name +
          ' (' +
          target.provider +
          via +
          '). It is working: it reads your message after its next step, without being interrupted (if it takes no step within a minute, or ends its task first, it gets it as its next prompt)' +
          linked(true),
      };
    }
    const r = await deliver(target, body, heldOpts);
    if (r.state === 'held') {
      if (me) deps.hooks.note(paneId, { kind: 'mesh-out', to, text: 'Queued: ' + text });
      return {
        ok: true,
        queued: true,
        to:
          target.name +
          ' (' +
          target.provider +
          via +
          '). ' +
          (r.reason === 'draft'
            ? target.name +
              ' has unsent text in its input; it gets your message when that text is sent or cleared (not delivered if that takes over 10 min)'
            : r.reason === 'busy'
              ? target.name +
                ' is still working; it gets your message when its task ends, or sooner if the user sends it from its queue (use `tnai ask` when you need an answer now)'
              : 'Earlier prompts for it are still waiting; yours follows them') +
          '. Normal queueing, not an error: do not report it to the user as a problem' +
          linked(true),
      };
    }
    if (!r.ok) {
      if (mine) deps.graph.sentByParent(paneId, target.paneId, false);
      return errors.fail(
        'unreachable',
        'Not delivered to ' + target.name + ' (' + target.provider + '): ' + r.error,
        'tnai agents shows its state; then tnai send ' + target.name + ' MESSAGE again'
      );
    }
    deps.hooks.note(target.paneId, { kind: 'mesh-in', from, text });
    if (me)
      deps.hooks.note(paneId, {
        kind: 'mesh-out',
        to: target.provider + ' · ' + target.name,
        text,
      });
    return {
      ok: true,
      to: target.name + ' (' + target.provider + via + '). ' + DELIVERED[r.state] + linked(false),
    };
  }
  if (msg.op === 'read') {
    const target = await find(list, msg.from, project, paneId);
    if (target?.error) return errors.pass(target, 'invalid', TRY.agents);
    if (!target)
      return {
        ok: false,
        code: 'not_found',
        hint: TRY.agents,
        error:
          'No agent "' +
          label(msg.from) +
          '" in this project. Agents here: ' +
          others(list, project, paneId) +
          '.',
      };
    const count = Math.min(READ_MAX, Math.max(1, Number(msg.lines) | 0 || 40));

    // Only the buffer's tail is cleaned first (up to 256 KB of scrollback per pane, and many agents
    // may read at once); the whole buffer when the tail is too short.
    const all = deps.ptys.replay(target.paneId)?.buffer || '',
      cut = all.length > READ_TAIL ? all.indexOf('\n', all.length - READ_TAIL) + 1 : 0;
    const strip = raw =>
      raw
        .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '')
        .replace(/\x1b[@-_]/g, '')
        .split('\n')
        .map(l => l.split('\r').filter(Boolean).pop() || '')
        .map(l => l.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd());
    let lines = strip(cut > 0 ? all.slice(cut) : all);
    if (cut > 0 && lines.filter(Boolean).length < count) lines = strip(all);
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return {
      ok: true,
      name: target.name,
      provider: target.provider,
      text: lines.slice(-count).join('\n'),
    };
  }
  const alive = p => list.some(m => m.paneId === p && m.project === project);
  const myName = label(names.get(paneId)?.name || me?.name || paneId);

  // `tnai server list | claim URL | release [URL]` (dev-servers.js): who owns which localhost dev
  // server here.
  if (msg.op === 'server') {
    const how = { answers, alive };
    if (msg.action === 'list') return servers.list(project, how);
    const url = msg.url ? localUrl(clean(msg.url, 2000)) : '';
    if (msg.url && !url)
      return errors.fail(
        'invalid',
        'Dev servers are addresses on this computer only: http://localhost:PORT, 127.0.0.1 or [::1].',
        'tnai server claim http://localhost:PORT'
      );
    if (msg.action === 'claim')
      return url
        ? servers.claim(project, paneId, myName, url, how)
        : errors.fail(
            'invalid',
            'Which address? tnai server claim http://localhost:PORT',
            'tnai server claim http://localhost:PORT'
          );
    if (msg.action === 'release') return servers.release(project, paneId, url);
    return errors.fail(
      'invalid',
      'Use tnai server list | claim URL | release [URL].',
      'tnai server list'
    );
  }

  // `tnai test` (test-queue.js): the shim runs the tests once this answers; the open connection
  // holds the turn until the run ends.
  if (msg.op === 'test') {
    if (!socket)
      return errors.fail('internal', 'No connection to hold the test turn.', 'tnai test again');
    const got = await tests.turn(paneId, myName, project, socket);
    return got
      ? { ok: true, hold: true, waited: got.waited, after: got.after }
      : errors.fail('busy', 'Stopped while waiting for the test turn.', 'tnai test again');
  }

  // `tnai tasks ...` (agent-tasks.js): the project's shared to-do board.
  if (msg.op === 'tasks') {
    const instanceOf = p => deps.lifecycle?.instanceOf(p) || p;
    const liveNames = () =>
      new Map(list.filter(m => m.project === project).map(m => [instanceOf(m.paneId), m.name]));
    return tasks.run(
      project,
      { instance: instanceOf(paneId), name: myName },
      Array.isArray(msg.args) ? msg.args.map(a => clean(a, 400)) : [],
      liveNames
    );
  }
  if (msg.op === 'preview') return preview(paneId, project, msg);
  if (msg.op === 'show') return show(paneId, project, msg);
  if (msg.op === 'shot') return shot(paneId, project, msg);

  // `tnai pr [watch [NUMBER] | unwatch]` (pr-watch.js): the caller's own thread's pull request.
  if (msg.op === 'pr') {
    if (!deps.prWatch)
      return errors.fail('unreachable', 'Pull request watching is not available.', TRY.again);
    const action = ['watch', 'unwatch'].includes(msg.action) ? msg.action : '';
    const result = await deps.prWatch.command(paneId, action, Number(msg.number) || 0);
    return result.ok ? result : errors.fail('refused', result.error, 'gh pr view');
  }

  // Shared project context (agent-context.js): finished work of the agents in this project.
  // File locks (file-locks.js): `tnai lock FILE...` before editing (Claude Code locks by itself
  // through its edit hook), `tnai unlock [FILE...]`, `tnai locks`.
  if (msg.op === 'lock' || msg.op === 'unlock' || msg.op === 'locks') {
    if (!deps.locks) return errors.fail('unreachable', 'File locks are not available.', TRY.again);
    const base = typeof msg.cwd === 'string' && path.isAbsolute(msg.cwd) ? msg.cwd : project;
    const files = (Array.isArray(msg.files) ? msg.files : [])
      .slice(0, 50)
      .map(f => path.resolve(base, clean(String(f), 400)));
    if (msg.op === 'locks') {
      const rows = deps.locks.list(project),
        ago = t => Math.floor((Date.now() - t) / 60000) + ' min';
      return {
        ok: true,
        text: rows.length
          ? 'File locks in this project (' +
            rows.length +
            '):\n' +
            rows
              .map(
                r =>
                  '  ' +
                  r.file +
                  '  ·  ' +
                  r.name +
                  (r.provider ? ' (' + r.provider + ')' : '') +
                  (r.paneId === paneId ? ' (you)' : '') +
                  '  ·  held ' +
                  ago(r.at) +
                  ', last edit ' +
                  ago(r.last) +
                  ' ago'
              )
              .join('\n')
          : 'No file locks in this project.',
      };
    }
    if (msg.op === 'unlock') {
      const r = deps.locks.release(project, files.length ? files : null, paneId);
      return {
        ok: true,
        text: r.released.length
          ? 'Unlocked: ' + r.released.join(', ')
          : 'You held no matching locks.',
      };
    }
    const me = {
      paneId,
      name: names.get(paneId)?.name || paneId,
      provider: (await members()).find(m => m.paneId === paneId)?.provider || '',
    };
    const got = [],
      holders = [],
      refused = [],
      outside = [],
      folders = [];
    for (const f of files) {
      if (!deps.locks.rel(project, f)) {
        outside.push(f);
        continue;
      }

      // A lock is matched against the edited file's own path, so one on a folder guards nothing.
      let isFolder = false;

      try {
        isFolder = fs.statSync(f).isDirectory();
      } catch {}

      if (isFolder) {
        folders.push(deps.locks.rel(project, f));
        continue;
      }
      const r = deps.locks.acquire(project, f, me);
      if (r.ok) got.push(deps.locks.rel(project, f));
      else {
        refused.push(r.text);
        if (r.holder?.name && !holders.includes(r.holder.name)) holders.push(r.holder.name);
      }
    }
    const text =
      (got.length ? 'Locked: ' + got.join(', ') + '. `tnai unlock` when done.\n' : '') +
      (refused.length ? 'Refused:\n  ' + refused.join('\n  ') + '\n' : '') +
      (outside.length ? 'Not in this project (not locked): ' + outside.join(', ') + '\n' : '') +
      (folders.length
        ? 'A folder (not locked, lock the files in it): ' + folders.join(', ') + '\n'
        : '');
    const failed = refused.length || (folders.length && !got.length);
    if (!failed) return { ok: true, text: text.trim() };

    // A file held by another agent: who holds it, and the message that splits the work. Only
    // folders given: the files in them are what can be locked.
    return refused.length
      ? errors.fail(
          'locked',
          text.trim(),
          'tnai locks, then ' +
            holders.map(h => 'tnai send ' + h + ' MESSAGE').join(' or ') +
            ' to split the files'
        )
      : errors.fail('invalid', text.trim(), 'tnai lock FILE, for each file inside the folder');
  }

  // Team mode (agent-teams.js): `tnai team` shows the caller's team. Only the user changes teams:
  // `tnai team NAME NAME...` (group them) and `tnai team off NAME...` (take them off) work only
  // when typed in a plain terminal panel, never from an agent session (its shell commands use its
  // token).
  if (msg.op === 'team') {
    if (!deps.teams) return errors.fail('unreachable', 'Teams are not available.', TRY.again);
    const list = await members(),
      here = list.filter(m => m.project === project),
      nameOf = p => here.find(m => m.paneId === p)?.name || names.get(p)?.name || p;
    const words = (Array.isArray(msg.names) ? msg.names : [])
      .map(n => clean(String(n), 120))
      .filter(Boolean)
      .slice(0, 12);
    if (!words.length) {
      const own = deps.teams.mates(paneId);
      const all = deps.teams
        .state()
        .teams.map(t => t.panes.filter(p => here.some(m => m.paneId === p)))
        .filter(t => t.length >= 2);
      return {
        ok: true,
        text:
          (own.length
            ? 'Your team (set by the user): you + ' +
              own.map(nameOf).join(', ') +
              '. You share file locks: split files with `tnai send`; a whole-file rewrite (Write) is exclusive for 2 min.\n'
            : 'You are not on a team.\n') +
          (all.length
            ? 'Teams in this project:\n' + all.map(t => '  ' + t.map(nameOf).join(' + ')).join('\n')
            : 'No teams in this project.') +
          '\nOnly the user sets teams (a thread’s "..." menu > Team).',
      };
    }
    if (list.some(m => m.paneId === paneId))
      return {
        ok: false,
        code: 'refused',
        hint: 'ask the user to set the team',
        error:
          'Only the user sets teams (a thread’s "..." menu > Team, or `tnai team` typed in their own terminal). Agents cannot change them.',
      };
    const off = words[0] === 'off',
      found = [];
    for (const w of off ? words.slice(1) : words) {
      const t = await find(list, w, project, paneId);
      if (!t)
        return {
          ok: false,
          code: 'not_found',
          hint: TRY.agents,
          error:
            'No agent "' +
            label(w) +
            '" in this project. Agents here: ' +
            others(list, project, paneId) +
            '.',
        };
      if (t.error) return errors.pass(t, 'invalid', TRY.agents);
      if (!found.includes(t.paneId)) found.push(t.paneId);
    }
    if (off) {
      for (const p of found) deps.teams.leave(p);
      return {
        ok: true,
        text: found.length
          ? 'Off their team: ' + found.map(nameOf).join(', ') + '.'
          : 'Name the agents to take off their team.',
      };
    }
    if (found.length < 2)
      return errors.fail(
        'invalid',
        'A team needs at least two agents: tnai team NAME NAME...',
        'tnai team NAME NAME'
      );
    deps.teams.set(found[0], found.slice(1));
    return {
      ok: true,
      text:
        'Team: ' +
        found.map(nameOf).join(' + ') +
        '. They share file locks now and each was told who its teammates are. `tnai team off NAME` takes one off.',
    };
  }
  if (msg.op === 'context') {
    const args = Array.isArray(msg.args)
      ? msg.args.map(a => clean(String(a), 400)).slice(0, 20)
      : [];
    const out = deps.context.query(paneId, project, args);

    // Plain `tnai context`: also who is working in the project right now and whose task crosses the
    // caller's (agent-peers.js), for every CLI.
    if (out?.ok && !args.length && deps.peers)
      try {
        out.text += await deps.peers.board(paneId, project);
      } catch {}
    return out;
  }
  return errors.fail('invalid', 'Unknown request.', 'tnai (no words) prints how to use it');
}

// One JSON line in, one JSON line out; a registered launch keeps its connection open until the CLI
// exits.
function onSocket(socket) {
  let buffer = '',
    handled = false;
  socket.setEncoding('utf8');
  socket.setTimeout(10000, () => {
    if (!handled) socket.destroy();
  });
  socket.on('error', () => {});
  socket.on('data', async chunk => {
    if (handled) return;
    buffer += chunk;
    if (buffer.length > LINE_MAX) {
      socket.destroy();
      return;
    }
    const end = buffer.indexOf('\n');
    if (end < 0) return;
    handled = true;
    socket.setTimeout(0);
    let msg = null;
    try {
      msg = JSON.parse(buffer.slice(0, end));
    } catch {}
    const paneId =
      msg && typeof msg.token === 'string' && /^[0-9a-f]{32}$/.test(msg.token)
        ? tokens.get(msg.token)
        : null;
    const pane = paneId && panes.get(paneId);
    let reply;
    if (!pane || !['127.0.0.1', '::ffff:127.0.0.1'].includes(socket.remoteAddress))
      reply = errors.fail(
        'refused',
        'Refused: only terminals started by Technically Not can use the agent mesh.',
        'run it in a terminal Technically Not started (a thread, its CLI screen or Your terminal)'
      );
    else {
      try {
        reply = await request(paneId, pane, msg, socket);
      } catch (error) {
        reply = errors.fail('internal', error.message, TRY.again);
      }
    }

    // Every failure leaves with a code (agent-errors.js), also one handed on from another file.
    reply = errors.ensure(reply);
    if (socket.destroyed) return;
    socket.write(JSON.stringify(reply) + '\n');
    if (!(msg?.op === 'launch' && reply.register) && !(msg?.op === 'test' && reply.hold))
      socket.end();
  });
}

module.exports = {
  // mesh-commands-check.js: drops the 2-minute interrupt gap
  _test: { forgetIntervened: () => intervened.clear() },
  // The same two-minute count for an interrupt asked by a paired computer (remote-actions.js), so
  // an agent is interrupted at most once in that time whoever asks: how long until it may be again
  // (0: now), and "it was interrupted now".
  interruptLeft: paneId =>
    Math.max(0, INTERVENE_GAP_MS - (Date.now() - (intervened.get(paneId) || 0))),
  interruptedNow: paneId => {
    intervened.set(paneId, Date.now());
  },
  // the agent's name for a panel ('' when it has none); remote-service.js names "needs you" items
  // with it
  nameOf: paneId => names.get(paneId)?.name || '',
  // its task as the UI shows it ('' when none); main.js builds the agent list for paired computers
  // from it
  taskOf: paneId => names.get(paneId)?.task || '',
  // deps: { ptys, hooks, registry, projects: () => Promise<string[]> }
  init(sender, dependencies) {
    send = sender;
    deps = dependencies;
    tasks.init(path.join(app.getPath('userData'), 'agent-tasks'));

    // Technically Not started from a Technically Not pane (development) must find the real CLIs,
    // not the outer Technically Not's shims.
    const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
    if (key)
      process.env[key] = process.env[key]
        .split(path.delimiter)
        .filter(d => !/[\\/]agent-shims[\\/]?$/i.test(d))
        .join(path.delimiter);
    try {
      writeShims();
    } catch {}
  },
  prepare,
  // A PowerShell kept ready (pty-service.js warm) was prepared under its own id; the panel that
  // takes it over gets that entry (its token is already in the process's environment), exactly as
  // prepare(paneId) would have left it.
  adopt(from, paneId) {
    const pane = panes.get(from);
    if (!pane) return false;
    const old = panes.get(paneId);
    if (old) tokens.delete(old.token);
    panes.delete(from);
    panes.set(paneId, pane);
    tokens.set(pane.token, paneId);
    if (old?.hand) changed();
    return true;
  },
  // For the UI (37): who is an agent session, of which provider, in which project.
  // waitsOn / with / ring (agent-links.js): the agents this one waits on, works with (inferred from
  // their messages), and whether its waits form a ring.
  async state() {
    return {
      panes: (await members()).map(({ paneId, provider, project, hand, startedAt }) => ({
        paneId,
        provider,
        project,
        hand,
        startedAt,
        ...(deps.links?.of(paneId) || {}),
      })),
    };
  },
  // Pane names and tasks as the UI shows them, so `tnai agents` / `tnai send NAME` use the same
  // names. Hook (agent-hooks.js, each prompt): one line for an agent whose panel was renamed since
  // it was last told, then forgotten.
  renamedNote(paneId) {
    return [ownRenameNote(paneId), othersRenamedNote(paneId)].filter(Boolean).join('\n');
  },

  // The panes renamedNote may still have a line for (cheap, nothing is cleared): main.js asks it
  // after every name list, so a CLI without the prompt hook (Codex, OpenCode, Cursor Agent) gets
  // the line typed in like a team notice.
  renamesPending() {
    const out = [];
    for (const id of names.keys()) {
      const since = toldRenames.get(id);
      const others = since !== undefined && renameLog.some(r => r.seq > since && r.paneId !== id);
      if (renamed.has(id) || others) out.push(id);
    }
    return out;
  },
  setNames(list) {
    const before = new Map([...names].map(([id, n]) => [id, n.name]));
    names.clear();
    for (const item of Array.isArray(list) ? list.slice(0, 500) : []) {
      if (item && typeof item.paneId === 'string' && item.paneId.length <= 120)
        names.set(item.paneId, {
          name: label(item.name) || item.paneId,
          task: label(item.task).slice(0, 200),
          agent: label(item.agent),
          offline: item.offline === true,
          idle: item.idle === true,
          onAgents: item.onAgents === true,
          background: item.background === true,
          quietSince: Number(item.quietSince) > 0 ? Number(item.quietSince) : 0,
          kept: item.kept === true,
          cwd: typeof item.cwd === 'string' && path.isAbsolute(item.cwd) ? item.cwd : '',
        });
    }

    // A panel the user renamed: its agent is told once, with its next prompt (renamedNote), so its
    // messages and reports use the new name. A new panel is told only of renames after it came.
    for (const [id, n] of names) {
      const old = before.get(id);
      if (!before.has(id)) toldRenames.set(id, renameCount);
      if (old && old !== id && old !== n.name) {
        renamed.set(id, { from: renamed.get(id)?.from || old, to: n.name });
        noteRename(id, old, n.name);
      }
    }
    return true;
  },
  // The renames other agents are told about, for the desktop check (newest last).
  renames: () => renameLog.map(r => ({ ...r })),
  // Who a pane is, for a file lock taken by Claude Code's edit hook (file-locks.js): its name, CLI
  // and project; null when it is not an agent in an open project. Live agents of a project with
  // status and task, as `tnai agents` shows them (agent-peers.js).
  async roster(project, paneId = '') {
    return rows(await members(), project, paneId);
  },
  async owner(paneId) {
    const m = (await members()).find(x => x.paneId === paneId);
    return m && m.project
      ? { paneId, name: m.name, provider: m.provider, project: m.project }
      : null;
  },
  // The agent CLI started by hand in a terminal pane (attention-service.js draft keys), else null.
  cliOf(paneId) {
    return panes.get(paneId)?.hand?.agent || null;
  },
  forget(paneId) {
    lastShot.delete(paneId);
    renamedAt.delete(paneId);
    toldRenames.delete(paneId);

    // a closed panel is never interrupted or told of its rename again
    intervened.delete(paneId);
    renamed.delete(paneId);
    for (const [old, was] of formerNames) if (was.paneId === paneId) formerNames.delete(old);
    const pane = panes.get(paneId);
    if (!pane) return;
    tokens.delete(pane.token);
    panes.delete(paneId);
    names.delete(paneId);
    if (pane.hand) changed();
  },
  hint: HINT,
  // The renderer's answer to a `preview:show` request (31): { ok, error?, where? }.
  previewShown(id, r) {
    const resolve = previews.get(String(id));
    if (!resolve) return false;
    previews.delete(String(id));
    const sh = r?.shot,
      box = n => Math.round(Math.min(Math.max(Number(n) || 0, 200), 2560));
    const shotOf =
      sh && localUrl(sh.url) && DEVICES[sh.device]
        ? {
            url: localUrl(sh.url),
            device: sh.device,
            w: box(sh.w),
            h: box(sh.h),
            preset: label(sh.preset),
            label: label(sh.label),
          }
        : null;
    resolve(
      r?.ok === true
        ? { ok: true, where: sentence(r.where), shot: shotOf }
        : { ok: false, error: sentence(r?.error) || 'refused' }
    );
    return true;
  },

  // Another computer's view of this one's Live preview (remote-preview.js, plan item 43): the
  // address and viewport of the tab shown now in the project open here, asked of the window the
  // way `tnai shot preview` asks it (nothing changes on screen). null when no tab shows a page or
  // nothing answers at its address.
  async activePreview(project) {
    const id = crypto.randomBytes(8).toString('hex');
    const reply = new Promise(resolve => {
      previews.set(id, resolve);
      setTimeout(() => {
        if (previews.delete(id)) resolve({ ok: false });
      }, 6000);
    });
    send('preview:show', { id, shot: true, url: '', device: '', project, paneId: '' });
    const r = await reply;
    if (!r || !r.ok || !r.shot || !(await answers(r.shot.url))) return null;
    return r.shot;
  },
  stop() {
    if (server) server.close();
    server = null;
  },
};
