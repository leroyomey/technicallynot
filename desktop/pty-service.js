// Technically Not desktop · pty-service.js — Real terminal processes (node-pty/ConPTY): start,
// input, resize, stop, status, output replay; session records and scrollback kept on disk
// (session-store).
'use strict';
const crypto = require('crypto');
const pty = require('node-pty');

// node-pty's bundled conpty.dll + OpenConsole.exe (Windows): a 500-line paste reached Claude Code
// in ~0.45 s instead of ~0.9-1.1 s (2026-09-29).
const CONPTY_DLL = process.platform === 'win32';
const registry = require('./agent-registry');

// an API-key account's key, for its agent process only
const accounts = require('./account-service');
const store = require('./session-store');
const stalls = require('./stall-log');

// every pane's process tree in a kill-on-close Windows job
const guard = require('./process-guard');
const opencode = require('./opencode-store'); // OpenCode's session for a pane
const openCodeLink = require('./opencode-link'); // the link to an OpenCode panel's own server
const cursor = require('./cursor-store'); // Cursor Agent's chat for a pane

// node-pty 1.1 kill(): forks a helper that attaches to the shell's console to list its processes,
// then closes the pseudoconsole right away, so the helper usually finds the shell gone and crashes
// printing "AttachConsole failed" (and the kill waits 5 s for it). Same helper, quiet: its crash
// falls back to the shell's pid at once, which is what node-pty does on its own timeout.
try {
  const path = require('path'),
    { fork, spawn } = require('child_process');
  const {
    nodeHelper,
    helperEnv,
    processList,
    CONSOLE_LIST_PROGRAM,
    consoleListNative,
  } = require('./node-helper');
  const { WindowsPtyAgent } = require('node-pty/lib/windowsPtyAgent');
  const helper = path.join(
    path.dirname(require.resolve('node-pty/lib/windowsPtyAgent')),
    'conpty_console_list_agent'
  );

  // Looked up once, when the app starts: which program makes the list, and where the native file
  // is. Both are checks of the disk, which must not run at every panel close (the main process is
  // never blocked), and neither can change while the app runs.
  const runner = nodeHelper();
  const nativeFile = runner.asNode ? '' : consoleListNative({ ptyLib: path.dirname(helper) });
  WindowsPtyAgent.prototype._getConsoleProcessList = function () {
    const shell = this._innerPid;
    return new Promise(resolve => {
      let done = false;
      const finish = list => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(list);
        }
      };

      // `fork` starts the app itself as Node. With a shipped Node runtime that runtime makes the
      // list instead, over the same message channel, so the list still works once the app can no
      // longer be started as Node (node-helper.js). The runtime is handed the steps as one line of
      // text and the native file by its path, not node-pty's script: in an installed app that
      // script is inside app.asar, which a plain Node cannot read. When the native file is not
      // found as a real file, `fork` is used as before. windowsHide: the runtime is a console
      // program, and without it Windows would flash a console window at every panel close.
      const stdio = ['ignore', 'ignore', 'ignore', 'ipc'];
      const agent = nativeFile
        ? spawn(runner.exe, ['-e', CONSOLE_LIST_PROGRAM, nativeFile, String(shell)], {
            stdio,
            env: helperEnv(runner),
            windowsHide: true,
          })
        : fork(helper, [String(shell)], { stdio });

      // node-pty ends every process in the list, so a message of any other shape counts as no
      // answer: the shell's own pid, as on a crash.
      agent.on('message', message => finish(processList(message?.consoleProcessList) || [shell]));
      agent.on('exit', () => finish([shell]));
      agent.on('error', () => finish([shell]));
      const timer = setTimeout(() => {
        agent.kill();
        finish([shell]);
      }, 5000);
    });
  };
} catch {} // another node-pty layout: its own helper runs as before

const SCROLLBACK = 256 * 1024; // characters kept per session so a reloaded window can replay output
const TICK_MS = 2000; // scrollback is written to disk at most this often

// OpenCode / Cursor Agent session lookup while nothing new was printed since the last miss
const IDLE_LOOKUP_MS = 10000;
const INHERITED_SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_PID',

  // A Claude Code background session (the daemon's worker, Claude Code 2.1.300) is marked by
  // CLAUDE_CODE_SESSION_KIND=bg, and that marker forces the full-screen renderer before
  // CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN is even read. When the app was started from such a
  // session, every panel inherited it and drew full-screen, with no scrollback.
  'CLAUDE_CODE_SESSION_KIND',
  'CLAUDE_CODE_SESSION_NAME',
  'CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT',
  'CLAUDE_JOB_DIR',
];

// The rest of a background session's markers (CLAUDE_BG_BACKEND, CLAUDE_BG_PTY_AUTH and others):
// they point at the daemon's job and sockets, which a panel's own session must never use.
const INHERITED_BACKGROUND_PREFIX = 'CLAUDE_BG_';

// A copy of the app's environment for a new panel, without the markers above.
function panelEnvironment(source) {
  const env = { ...source };
  for (const key of INHERITED_SESSION_MARKERS) delete env[key];
  for (const key of Object.keys(env)) {
    if (key.startsWith(INHERITED_BACKGROUND_PREFIX)) delete env[key];
  }
  return env;
}
const sessions = new Map(); // paneId -> session

// paneId -> cancel generation, between stop() of the old process and the new one registering (start
// is async)
const starting = new Map();

// Per-pane cancel generation: bumped when the UI stops or closes the pane. A start begun under an
// older generation (main's pty:start awaits skills, hooks, worktree and mesh first) spawns nothing,
// so a panel closed while "Starting…" leaves no unseen process behind.
const generations = new Map();
const generation = paneId => generations.get(paneId) || 0;
const cancel = paneId => generations.set(paneId, generation(paneId) + 1);
const cancelled = (paneId, gen) => gen !== undefined && gen !== null && generation(paneId) !== gen;
let send = () => {};

function publicInfo(s) {
  return {
    paneId: s.paneId,
    agent: s.agent,
    mode: s.mode,
    cwd: s.cwd,
    pid: s.pid,
    startedAt: s.startedAt,
    accountId: s.accountId,
    sessionId: s.sessionId,
    customAgentId: s.customAgentId || '',
    ownedByUser: !!s.ownedByUser,
    access: s.access || '',
    commandLine: s.commandLine || '',
    appendPrompt: s.appendPrompt || '',
    resumable: !!s.resumable,
    lastOutputAt: s.lastOutputAt,
    exitCode: s.exitCode,
    running: s.exitCode === null,
    theme: s.theme || '',
  };
}

const ID_AT_START = ['Claude Code', 'Gemini CLI', 'GitHub Copilot'];

// A tool run through the ACP connector also gets its id at start: the connector names the
// session's record by it (acp-connector.js).
const idAtStart = agent => ID_AT_START.includes(agent) || registry.isAcp(agent);

// Whether the CLI has a saved conversation Technically Not can resume for this session.
function checkResumable(s) {
  if (s.mode !== 'run' || !s.sessionId) return false;
  if (s.agent === 'Claude Code')
    return store.claudeTranscriptExists(s.sessionId, s.cwd, s.accountDir);
  if (s.agent === 'Cursor Agent') return cursor.chatExists(s.cwd, s.sessionId);
  if (registry.isAcp(s.agent)) return require('./acp-connector').sessionExists(s.sessionId);
  return s.agent === 'Codex' || s.agent === 'OpenCode';
}

async function checkResumableAsync(s) {
  if (s.mode === 'run' && s.sessionId && s.agent === 'Claude Code')
    return store.claudeTranscriptExistsAsync(s.sessionId, s.cwd, s.accountDir);
  if (s.mode === 'run' && s.sessionId && s.agent === 'Gemini CLI')
    return store.geminiSessionExists(s.sessionId);
  if (s.mode === 'run' && s.sessionId && s.agent === 'GitHub Copilot')
    return store.copilotSessionExists(s.sessionId, s.accountDir);
  if (s.mode === 'run' && s.sessionId && registry.isAcp(s.agent))
    return require('./acp-connector').sessionExistsAsync(s.sessionId);
  return checkResumable(s);
}

function record(s, fields = {}, sync = false) {
  store.update(
    s.paneId,
    {
      agent: s.agent,
      mode: s.mode,
      accountId: s.accountId,
      accountDir: s.accountDir,
      customAgentId: s.customAgentId || '',
      ownedByUser: !!s.ownedByUser,
      sessionId: s.sessionId,
      resumable: !!s.resumable,
      cwd: s.cwd,
      startedAt: s.startedAt,
      lastOutputAt: s.lastOutputAt,
      running: s.exitCode === null,
      exitCode: s.exitCode,
      interrupted: false,
      ...fields,
    },
    sync
  );
}
const announce = s =>
  send('pty:session', {
    paneId: s.paneId,
    pid: s.pid,
    sessionId: s.sessionId,
    resumable: !!s.resumable,
  });

// The replay buffer notes every size the program drew for (a private OSC 7717 that terminals
// ignore), so a view replaying it resizes at the same points (10 createTerm) instead of drawing all
// of it at one width, which scrambles CLIs that redraw in place.
const MARK = '\x1b]7717;';
const sizeMark = (cols, rows) => MARK + cols + ';' + rows + '\x07';

// Trimmed only once it is TRIM_SLACK over the limit: trimming flattens and copies the whole buffer,
// and doing that for every output chunk kept the main process busy (and every IPC reply late) while
// agents printed fast.
const TRIM_SLACK = 64 * 1024;

// Private modes a replay needs from the cut-off part: the alternate screen (OpenCode and other
// full-screen TUIs draw only there; without it their frames land in the normal buffer, scroll, and
// mix old and new frames), mouse, paste, focus, cursor keys/visibility.
const MODES = new Set([
  '1',
  '25',
  '47',
  '1047',
  '1049',
  '1000',
  '1002',
  '1003',
  '1004',
  '1006',
  '1015',
  '2004',
]);
const MODE_RE = /\x1b\[\?([\d;]+)([hl])/g;

// The last `limit` characters, started on a new line (not inside an escape sequence), prefixed with
// the size note and the modes in effect at the cut, so a view replaying only the tail draws it like
// the whole. The result stays within `limit`.
function tail(buf, limit = SCROLLBACK) {
  if (buf.length <= limit) return buf;
  let cut = buf.length - limit + 512; // room for the prefix
  const nl = buf.indexOf('\n', cut);
  if (nl >= 0) cut = nl + 1;
  const at = buf.lastIndexOf(MARK, cut - 1),
    end = at >= 0 ? buf.indexOf('\x07', at) : -1;
  const modes = new Map(),
    head = buf.slice(0, cut);
  for (const m of head.matchAll(MODE_RE))
    for (const n of m[1].split(';'))
      if (MODES.has(n)) {
        modes.delete(n);
        modes.set(n, m[2]);
      }
  let prefix = end >= 0 && end < cut ? buf.slice(at, end + 1) : '';
  for (const alt of ['47', '1047', '1049'])
    if (modes.get(alt) === 'h') prefix += '\x1b[?' + alt + 'h'; // enter the screen first
  for (const [n, v] of modes) if (!['47', '1047', '1049'].includes(n)) prefix += '\x1b[?' + n + v;
  return prefix + buf.slice(cut);
}

function keep(s, data) {
  const buf = s.buffer + data;
  s.buffer = buf.length > SCROLLBACK + TRIM_SLACK ? tail(buf) : buf;
}

// Output (and size notes) go to the buffer and, batched into ~16 ms IPC messages so fast CLIs don't
// flood the renderer, to the views. One message per batch for all panes ([{ paneId, data }], fanned
// out per pane by preload.js): several agents streaming at once cost the renderer one IPC message a
// frame, not one per pane.
const flushing = new Set(); // sessions with output waiting in the current batch
let flushTimer = null;

function flushAll() {
  flushTimer = null;
  const batch = [];
  for (const s of flushing)
    if (s.pending) {
      batch.push({ paneId: s.paneId, data: s.pending });
      s.pending = '';
    }
  flushing.clear();
  if (batch.length) send('pty:data', batch);
  return batch.length > 0;
}

// While output keeps coming the timer stays on (one message per 16 ms, as before); it stops after a
// tick that had nothing to send.
const flushLater = () => {
  flushTimer = setTimeout(() => {
    if (flushAll()) flushLater();
  }, 16);
};

// Sends one session's waiting output now (before its pty:exit), keeping the other panes' batch as
// it is.
function flushOne(s) {
  flushing.delete(s);
  if (s.pending) {
    send('pty:data', [{ paneId: s.paneId, data: s.pending }]);
    s.pending = '';
  }
}

function emit(s, data) {
  keep(s, data);
  s.pending += data;
  s.unsaved += data;
  s.dirty = true;
  flushing.add(s);

  // Leading edge: output after a quiet 16 ms (a single echoed key) leaves at once; the timer then
  // batches what follows, as before.
  if (!flushTimer) {
    flushAll();
    flushLater();
  }
}

// Every TICK_MS while running: save new output (async write), find Codex's session id, notice when
// a conversation became resumable. The lookups are async and never overlap: a tick that finds the
// previous one still scanning skips them; they stop once found.
function tick(s) {
  if (s.dirty) {
    s.dirty = false;
    save(s);
  }
  if (
    s.looking ||
    (s.resumable && (s.sessionId || !['Codex', 'OpenCode'].includes(s.agent))) ||
    (s.agent === 'Cursor Agent' && s.sessionId)
  )
    return;

  // OpenCode / Cursor Agent before their first prompt: the lookup (a sync sqlite query / a readdir
  // + stat of every chat folder) found nothing and the pane printed nothing since, so it can wait
  // up to IDLE_LOOKUP_MS (their session appears with output).
  const now = Date.now();
  if (
    !s.sessionId &&
    (s.agent === 'OpenCode' || s.agent === 'Cursor Agent') &&
    s.lookedAt &&
    s.lastOutputAt <= s.lookedAt &&
    now - s.lookedAt < IDLE_LOOKUP_MS
  )
    return;
  s.looking = true;
  s.lookedAt = now;
  lookup(s)
    .catch(() => {})
    .finally(() => {
      s.looking = false;
    });
}

// New output is appended to the saved file; the file is rewritten from the buffer's tail only when
// the append would take it past the same limit the buffer trims at (or on the first save), so a
// busy pane writes its new output, not its whole 256 KB, every tick. Reads (restore, replay) cut
// the file to the tail the full rewrite would have saved.
function save(s) {
  if (s.fileLen >= 0 && s.fileLen + s.unsaved.length <= SCROLLBACK + TRIM_SLACK) {
    store.appendScrollback(s.paneId, s.unsaved);
    s.fileLen += s.unsaved.length;
  } else {
    const t = tail(s.buffer);
    store.saveScrollback(s.paneId, t);
    s.fileLen = t.length;
  }
  s.unsaved = '';
}

async function lookup(s) {
  let changed = false;
  if (s.agent === 'Codex' && s.mode === 'run' && !s.sessionId) {
    const taken = new Set([...sessions.values()].map(o => o.sessionId).filter(Boolean));
    const id = await store.findCodexSession(s.startedAt, s.cwd, s.accountDir, taken);
    if (id && !s.sessionId) {
      s.sessionId = id;
      changed = true;
    }
  }

  // OpenCode sets no id at launch either: its session in this folder since the pane started
  // (opencode-store.js; it appears with the first prompt).
  if (s.agent === 'OpenCode' && s.mode === 'run' && !s.sessionId) {
    const taken = new Set([...sessions.values()].map(o => o.sessionId).filter(Boolean));

    // With the link on, the id comes from the panel's own server (opencode-link.js); the
    // folder-and-time match stays the fallback.
    const id =
      openCodeLink.state(s.paneId)?.sessionId ||
      opencode.findSession(s.startedAt, s.cwd, taken, s.paneId);
    if (id && !s.sessionId) {
      s.sessionId = id;
      changed = true;
    }
  }

  // Cursor Agent too: its chat in this folder since the pane started (cursor-store.js; the
  // transcript folder appears with the first prompt).
  if (s.agent === 'Cursor Agent' && s.mode === 'run' && !s.sessionId) {
    const taken = new Set([...sessions.values()].map(o => o.sessionId).filter(Boolean));
    const id = cursor.findChat(s.startedAt, s.cwd, taken);
    if (id && !s.sessionId) {
      s.sessionId = id;
      changed = true;
    }
  }
  if (!s.resumable && (await checkResumableAsync(s))) {
    s.resumable = true;
    changed = true;
  }
  if (changed && sessions.get(s.paneId) === s) {
    record(s);
    announce(s);
  } // a pane stopped meanwhile keeps the record stop() wrote
}

// opts from the UI: accountId (resolved to accountDir by main), sessionId (fresh session id),
// resumeId (resume that session). askOnResume is main's alone (remote-actions.js startOptions): a
// resumed conversation that must run at "Ask first" (agent-registry.js spec).
async function start({
  paneId,
  agent,
  mode = 'run',
  cwd,
  cols = 100,
  rows = 30,
  accountId = '',
  accountDir = '',
  sessionId = '',
  resumeId = '',
  model = '',
  effort = '',
  access = '',
  askOnResume = false,
  customAgentId = '',
  ownedByUser = false,
  pluginDirs = [],
  appendPrompt = '',
  appendPromptFile = '',
  settingsFile = '',
  mcpConfig = '',
  workRules = '',
  rulesFile = '',
  rulesPlugin = '',
  addDirs = [],
  chrome = false,
  trust = false,
  login = null,
  paneEnv = null,
  theme = '',
  generation: gen,
  shell = '',
}) {
  // One start at a time per pane: a second (Enter twice, Enter + Build panel Start) would put two
  // CLIs' output in one panel. A start the user already cancelled (stop/close, then a new start)
  // doesn't block the new one.
  if (starting.has(paneId) && !cancelled(paneId, starting.get(paneId)))
    throw new Error('This panel is already starting.');
  if (cancelled(paneId, gen))
    throw Object.assign(new Error('The panel was closed before its process started.'), {
      code: 'cancelled',
    });
  stop(paneId);
  const mine = gen ?? generation(paneId);
  starting.set(paneId, mine);
  try {
    return await launch({
      paneId,
      agent,
      mode,
      cwd,
      cols,
      rows,
      accountId,
      accountDir,
      sessionId,
      resumeId,
      model,
      effort,
      access,
      askOnResume,
      customAgentId,
      ownedByUser,
      pluginDirs,
      appendPrompt,
      appendPromptFile,
      settingsFile,
      mcpConfig,
      workRules,
      rulesFile,
      rulesPlugin,
      addDirs,
      chrome,
      trust,
      login,
      paneEnv,
      theme,
      gen,
      shell,
    });
  } finally {
    if (starting.get(paneId) === mine) starting.delete(paneId);
  }
}

async function launch({
  paneId,
  agent,
  mode,
  cwd,
  cols,
  rows,
  accountId,
  accountDir,
  sessionId,
  resumeId,
  model,
  effort,
  access,
  askOnResume = false,
  customAgentId,
  ownedByUser,
  pluginDirs,
  appendPrompt,
  appendPromptFile,
  settingsFile,
  mcpConfig,
  workRules,
  rulesFile,
  rulesPlugin,
  addDirs,
  chrome,
  trust,
  login,
  paneEnv,
  theme,
  gen,
  spare = false,

  // "Your terminal" only: the shell the user chose for it (agent-registry.js `shells`)
  shell = '',
}) {
  // Claude Code, Gemini CLI and GitHub Copilot (`--session-id`, agent-registry.js) accept a session
  // id at start, so Technically Not always knows which conversation a pane holds.
  if (idAtStart(agent) && mode === 'run' && !sessionId && !resumeId)
    sessionId = crypto.randomUUID();

  // OpenCode's own server for this panel (opencode-link.js): a loopback port and a password, only
  // on a tested OpenCode version; null = start as before.
  const serverLink =
    agent === 'OpenCode' && mode === 'run' ? await openCodeLink.launch(paneId) : null;
  const spec = await registry.spec(agent, mode, {
    shell,
    serverPort: serverLink?.port,
    accountDir,
    sessionId,
    resumeId,
    model,
    effort,
    access,
    askOnResume: askOnResume === true,
    pluginDirs,
    appendPrompt,
    appendPromptFile,
    settingsFile,
    mcpConfig,
    workRules,
    rulesFile,
    rulesPlugin,
    addDirs,
    chrome,
    trust,
    login: mode === 'login' ? login : null,
  });
  if (cancelled(paneId, gen))
    throw Object.assign(new Error('The panel was closed before its process started.'), {
      code: 'cancelled',
    });
  const home = process.env.USERPROFILE || require('os').homedir() || process.cwd();

  // Markers of the Claude Code session Technically Not itself may have been started from; an agent
  // pane is its own top-level session.
  const env = panelEnvironment(process.env);

  // Agent mesh (agent-mesh.js): shim folder first on PATH, the pane's token and port.
  if (typeof paneEnv === 'function') paneEnv(env);

  // mac/Linux bash: `bash -l` reads the user's login files after that, and they often put a folder
  // first (Ubuntu's ~/.profile: ~/.local/bin, where Claude Code installs `claude`), so a typed
  // agent CLI skipped the shim. The panel's bash runs the same login files from the shim folder's
  // tnai-bashrc (agent-mesh.js), which then puts the shim folder first again.
  const rc =
    env.TNAI_SHIM &&
    agent === 'Terminal' &&
    /(^|\/)bash$/.test(spec.file) &&
    spec.args.join(' ') === '-l'
      ? require('path').join(require('path').dirname(env.TNAI_SHIM), 'tnai-bashrc')
      : '';
  if (rc && require('fs').existsSync(rc)) spec.args = ['--rcfile', rc, '-i'];

  // zsh (the macOS default, common on Linux) likewise, through ZDOTDIR=<shim folder>/tnai-zsh
  // (agent-mesh.js).
  const zdir =
    env.TNAI_SHIM && agent === 'Terminal' && /(^|\/)zsh$/.test(spec.file)
      ? require('path').join(require('path').dirname(env.TNAI_SHIM), 'tnai-zsh')
      : '';
  if (zdir && require('fs').existsSync(require('path').join(zdir, '.zlogin'))) {
    env.TNAI_USER_ZDOTDIR = env.ZDOTDIR || env.HOME || require('os').homedir();
    env.ZDOTDIR = zdir;
  }

  // fish likewise: --init-command runs after the user's config.fish, so the shim folder ends up
  // first again.
  if (env.TNAI_SHIM && agent === 'Terminal' && /(^|\/)fish$/.test(spec.file))
    spec.args = [...spec.args, '--init-command', 'set -gx PATH (dirname $TNAI_SHIM) $PATH'];

  // Claude Code's classic renderer (normal screen; the 2026-09 claude.exe:
  // "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 forces that"), also when typed into a PowerShell pane:
  // its output lands in the pane's scrollback, so the mouse wheel scrolls it (10-live-terminals.js)
  // and replay, mirrors and saved scrollback keep the whole conversation. The full-screen renderer
  // draws one screen with no scrollback.
  env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = '1';

  // An API-key account's key (account-service.js keyEnv): only in this agent's own environment,
  // never in its arguments (commandLine is recorded and shown), in a sign-in run, or in a
  // PowerShell panel.
  if (mode === 'run' && accountId && agent !== 'Terminal')
    Object.assign(env, accounts.keyEnv(agent, accountId));

  // The keys of this thread's connections (connections.js): the same way, environment only, so a
  // connection's settings name the variable and never hold the key.
  if (mode === 'run' && agent !== 'Terminal')
    Object.assign(env, require('./connections').envFor(paneId));

  // the password: environment only, never an argument
  if (serverLink) spec.env = { ...(spec.env || {}), ...serverLink.env };

  // node-pty takes a string as a raw Windows command line, which keeps .cmd quoting intact.
  // A named section (stall-log.js): starting the console host and the program is synchronous, so a
  // stall line can name it.
  const proc = stalls.timed('pty spawn ' + agent, pty.spawn)(
    spec.file,
    spec.verbatim ? spec.args.join(' ') : spec.args,
    {
      name: 'xterm-256color',
      cols: Math.max(20, cols | 0),
      rows: Math.max(5, rows | 0),
      cwd: cwd || home,
      env: {
        ...env,
        ...(spec.env || {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        ...(theme === 'light' || theme === 'dark'
          ? { COLORFGBG: theme === 'light' ? '0;15' : '15;0' }
          : {}),
      },
      useConpty: true,
      useConptyDll: CONPTY_DLL,
    }
  );

  // node-pty's Windows input socket (our writes to the program) has no 'error' listener, so a write
  // that fails as the program exits (write EAGAIN/EPIPE) became an uncaught main-process exception
  // and a native "JavaScript error" dialog (2026-09-30, a CLI that exited at once). Nothing to do
  // for it: the exit is reported by onExit as before.
  try {
    proc._agent?.inSocket?.on('error', () => {});
  } catch {}
  if (serverLink) openCodeLink.started(paneId, serverLink.id);
  guard.track(proc.pid); // at once: what it starts from now on joins its job too (process-guard.js)

  // commandLine: the launch arguments (not the executable), so the UI and tests can see a custom
  // agent's --plugin-dir / --append-system-prompt-file; appendPrompt: the text in that file (rules,
  // identity).
  const s = {
    paneId,
    agent,
    mode,
    cwd: cwd || home,
    pid: proc.pid,
    proc,
    accountId,
    accountDir,
    customAgentId,
    ownedByUser: !!ownedByUser,
    access:
      typeof access === 'string'
        ? access
        : '' /* the level it was started at, for remote-say.js (an agent on another computer may message only one started at "ask") */,
    commandLine: spec.args.join(' '),
    appendPrompt: mode === 'run' && agent === 'Claude Code' ? appendPrompt : '',
    sessionId: mode === 'run' ? resumeId || sessionId : '',
    startedAt: Date.now(),
    lastOutputAt: 0,
    exitCode: null,
    serverLink: serverLink?.id || '',
    buffer: sizeMark(proc.cols, proc.rows),
    pending: '',
    unsaved: '',
    fileLen: -1,
    dirty: false,
    resumable: false,
    theme: theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : '',
  };

  // A Claude Code session id made just now (not a resume) has no transcript yet: skip the sync scan
  // of every ~/.claude/projects folder on the main process while other panes stream; the 2 s tick
  // (lookup) notices once the conversation is saved.
  s.resumable = idAtStart(agent) && !resumeId ? false : checkResumable(s);

  // A PowerShell kept ready (warm below) belongs to no panel yet: no session, record or ticker
  // until a panel takes it (adopt).
  if (spare) {
    s.spare = true;
    s.held = '';
    ready = { s, id: paneId, cwd: s.cwd, theme: s.theme };
  } else {
    sessions.set(paneId, s);
    record(s);
    s.ticker = setInterval(() => tick(s), TICK_MS);
  }

  // The bundled OpenConsole opens with ESC[1t ESC[c and waits ~3 s for the device-attributes answer
  // before the program may draw (a PowerShell prompt came after 3.2 s instead of 0.2 s). Answered
  // here at once with xterm.js's own reply and taken out of the output, so no terminal view or
  // scrollback replay answers it again later (a late answer would land in the program's input).
  let handshake = CONPTY_DLL ? Date.now() + 5000 : 0;
  proc.onData(
    stalls.timed('pty output', data => {
      // a stall line can name it
      if (handshake) {
        const i = data.indexOf('\x1b[c');
        if (i >= 0) {
          handshake = 0;
          data = data.slice(0, i) + data.slice(i + 3);
          try {
            proc.write('\x1b[?1;2c');
          } catch {}
        } else if (Date.now() > handshake) handshake = 0;
        if (!data) return;
      }
      s.lastOutputAt = Date.now();
      if (s.spare) {
        s.held = (s.held + data).slice(-65536);
        return;
      } // shown to the panel that takes it
      emit(s, data);
    })
  );
  proc.onExit(({ exitCode }) => {
    // the panel that holds it now (a ready PowerShell got its panel in adopt)
    const paneId = s.paneId;
    if (s.spare) {
      s.exitCode = exitCode ?? 0;
      if (ready?.s === s) ready = null;
      releaseConout(s);
      guard.end(s.pid);
      return;
    }
    if (flushing.has(s)) flushOne(s);
    s.exitCode = exitCode ?? 0;
    clearInterval(s.ticker);
    releaseConout(s);

    // The pane's program ended by itself (an agent CLI quit, `exit` in a shell): whatever it left
    // running in the background ends too.
    guard.end(s.pid);

    // mac/Linux: e.g. `sleep 99 & exit` (bash leaves running jobs behind on exit)
    if (process.platform !== 'win32') endSession(s.pid);

    // A stopped or replaced session was already recorded by stop(); only the pane's current process
    // updates the record.
    const current = sessions.get(paneId);
    if (s.serverLink) openCodeLink.close(paneId, s.serverLink, s.exitCode);
    if (current === s) {
      tick(s);
      s.resumable = checkResumable(s);
      record(s);
    }

    // A replaced process (restart/resume in the same pane) ends quietly: its late exit must not end
    // the new session's hooks, lifecycle or graph node.
    if ((current && current !== s) || (!current && starting.has(paneId))) return;
    send('pty:exit', { paneId, pid: s.pid, exitCode: s.exitCode });
  });
  return publicInfo(s);
}

// A PowerShell kept ready, so that a new PowerShell panel loads at once (Windows
// PowerShell needs about a second from its start until it takes a command). One
// hidden PowerShell is started ahead in the project folder; a plain PowerShell panel that starts in
// the same folder and theme takes it over (adopt) with its first prompt already drawn, and main
// starts the next one. It is an ordinary process of this service (same spec, environment and job
// tracking as a panel's), only without a panel: it is in no list, saves nothing, and ends with the
// app, with the setting (unwarm), or when the folder or theme changes (warm).
let ready = null; // { s, id, cwd, theme }

// Nothing is typed into it while it waits: keys sent ahead to "wake" its line editor made no
// measurable difference (PowerShell shows a first command at once; what is left, about 0.2 s, is
// its first command running, which only running a command would pay ahead).
const readyInfo = () =>
  ready && ready.s.exitCode === null ? { id: ready.id, cwd: ready.cwd, theme: ready.theme } : null;

function unwarm() {
  const r = ready;
  ready = null;
  if (r && r.s.exitCode === null) {
    try {
      r.s.proc.kill();
    } catch {}
  }
}

async function warm({ id, cwd, theme = '', cols = 100, rows = 30, paneEnv = null }) {
  unwarm();
  await launch({
    paneId: id,
    agent: 'Terminal',
    mode: 'run',
    cwd,
    cols,
    rows,
    accountId: '',
    accountDir: '',
    sessionId: '',
    resumeId: '',
    model: '',
    effort: '',
    customAgentId: '',
    ownedByUser: false,
    pluginDirs: [],
    appendPrompt: '',
    appendPromptFile: '',
    settingsFile: '',
    mcpConfig: '',
    workRules: '',
    rulesFile: '',
    rulesPlugin: '',
    addDirs: [],
    chrome: false,
    trust: false,
    login: null,
    paneEnv,
    theme,
    spare: true,
  });
  return readyInfo();
}

// Hands the ready PowerShell to `paneId` (null when there is none): from here on it is that panel's
// session like any started one. What it printed so far (its first prompt) goes to the panel right
// after the start reply, then its size follows the panel's.
function adopt({ paneId, cols, rows, generation: gen }) {
  const r = ready;
  if (!r || r.s.exitCode !== null) return null;
  if (starting.has(paneId) && !cancelled(paneId, starting.get(paneId)))
    throw new Error('This panel is already starting.');
  if (cancelled(paneId, gen))
    throw Object.assign(new Error('The panel was closed before its process started.'), {
      code: 'cancelled',
    });
  stop(paneId);
  ready = null;
  const s = r.s,
    held = s.held || '';
  s.spare = false;
  s.held = '';
  s.paneId = paneId;
  s.startedAt = Date.now();
  sessions.set(paneId, s);
  record(s);
  s.ticker = setInterval(() => tick(s), TICK_MS);
  cols = Math.max(20, cols | 0);
  rows = Math.max(5, rows | 0);
  setImmediate(() => {
    if (sessions.get(paneId) !== s || s.exitCode !== null) return;
    if (held) {
      s.lastOutputAt = Date.now();
      emit(s, held);
    }
    if (cols !== s.proc.cols || rows !== s.proc.rows) {
      try {
        s.proc.resize(cols, rows);
        emit(s, sizeMark(cols, rows));
      } catch {}
    }
  });
  return publicInfo(s);
}

// With the bundled conpty.dll, node-pty 1.1.0 runs a conout worker thread per pty and disposes it
// only on a socket 'data' event after kill() (windowsPtyAgent.js), which never comes
// (windowsTerminal closes that socket first), and never when the program exits by itself: every
// closed panel left a live thread, ~6 MB and a MessagePort each (agent-soak, 2026-09-29). Disposed
// here once the process has exited or been killed, a second later so its last output has drained.
// Idempotent; node-pty internals, guarded.
function releaseConout(s) {
  if (!CONPTY_DLL || s.conoutReleased) return;
  s.conoutReleased = true;
  setTimeout(() => {
    try {
      s.proc?._agent?._conoutSocketWorker?.dispose();
    } catch {}
  }, 1000).unref?.();
}

// reason 'quit': Technically Not is closing, so the record keeps "interrupted" and the pane offers
// to resume next time.
function stop(paneId, reason) {
  const s = sessions.get(paneId);
  if (!s) return false;
  sessions.delete(paneId);
  clearInterval(s.ticker);
  flushing.delete(s);
  s.pending = ''; // no stray output from this process after the pane moves on
  const quitting = reason === 'quit'; // written synchronously: the process ends right after
  store.saveScrollback(paneId, tail(s.buffer), quitting);
  s.resumable = checkResumable(s);
  record(s, { running: false, interrupted: quitting && s.exitCode === null }, quitting);
  if (s.exitCode === null) killTree(s, quitting);
  return true;
}

// node-pty 1.1 (ConPTY) crashes the main process (0xC0000005) when many ptys close at the same
// moment, as closing a workspace does; one at a time CLOSE_GAP ms apart never did (stress-soak). A
// single close still runs at once.
const CLOSE_GAP = 60,
  closeQueue = [];
let closeTimer = null;

function queueClose(fn) {
  closeQueue.push(fn);
  if (!closeTimer) drainCloses();
}

function drainCloses() {
  const fn = closeQueue.shift();
  if (!fn) {
    closeTimer = null;
    return;
  }
  try {
    fn();
  } catch {}
  closeTimer = setTimeout(drainCloses, CLOSE_GAP);
}

// Ends the process and everything it started (an agent's background shells, watchers, dev servers):
// on Windows those keep running, parentless, when only the pane's process ends. The pane's job
// (process-guard.js) holds all of them, also ones whose parent already exited; without it (helper
// unavailable) taskkill /T walks the tree while its root is still alive, so it runs before the pty
// closes. A tracked pane closes its pty first, then ends its job: ending the shell before
// proc.kill() leaves the pane's conhost.exe running, one per closed pane, never reaped
// (stress-soak). The job still ends everything the pane started, also ones whose parent exited.
// Quitting doesn't wait for tracked panes (Technically Not's exit ends every job anyway); only the
// untracked fallback runs taskkill synchronously.
function killTree(s, sync) {
  const closePty = () => {
    try {
      s.proc.kill();
    } catch {}
    releaseConout(s);
  };
  if (!s.pid) return queueClose(closePty);
  if (process.platform !== 'win32') return killGroup(s.pid, closePty, sync);
  if (guard.isTracked(s.pid)) {
    const end = () => {
      closePty();
      guard.end(s.pid);
    };
    return sync ? end() : queueClose(end);
  }
  const { execFile, execFileSync } = require('child_process'),
    args = ['/PID', String(s.pid), '/T', '/F'],
    opts = { windowsHide: true, stdio: 'ignore', timeout: 5000 };
  if (!sync)
    return void execFile('taskkill', args, opts, () =>
      guard.end(s.pid).then(() => queueClose(closePty))
    );
  try {
    execFileSync('taskkill', args, opts);
  } catch {} // already gone
  guard.end(s.pid);
  closePty();
}

// mac/Linux: node-pty starts the terminal panel's process as a session leader, so its process group
// holds what it started (background shells, dev servers). SIGTERM to the group, the pty closes,
// then SIGKILL after 2 s for anything that ignored it (skipped when quitting: the app is gone by
// then). Falls back to the pid alone if the group is already gone.
function killGroup(pid, closePty, sync) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
  if (sync) {
    signalSession(pid, 'SIGTERM');
    return closePty();
  }
  endSession(pid);
  queueClose(closePty);
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {}
  }, 2000).unref?.();
}

// Linux: the group alone misses a shell's background jobs (each job is its own process group) and
// what a subshell left behind (`(cmd &)`, parent gone). All of them stay in the pane's terminal
// session, whose id is the pane process's pid (node-pty makes it the session leader; Linux never
// reuses a pid still used as a session id). SIGTERM, then SIGKILL 2 s later. macOS has no /proc:
// group only.
function sessionPids(sid) {
  const fs = require('fs'),
    out = [];
  if (process.platform !== 'linux' || !sid) return out;
  let dirs = [];
  try {
    dirs = fs.readdirSync('/proc');
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!/^\d+$/.test(d) || +d === process.pid) continue;
    try {
      const stat = fs.readFileSync('/proc/' + d + '/stat', 'utf8'),
        f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (+f[3] === sid) out.push(+d);
    } catch {} // state ppid pgrp session
  }
  return out;
}

function signalSession(pid, signal) {
  for (const p of sessionPids(pid))
    try {
      process.kill(p, signal);
    } catch {}
}

function endSession(pid) {
  signalSession(pid, 'SIGTERM');
  setTimeout(() => signalSession(pid, 'SIGKILL'), 2000).unref?.();
}

// A pane's session from the store when no process runs for it (after a restart or crash).
function savedInfo(paneId, r, resumable, buffer) {
  return {
    paneId,
    agent: r.agent,
    mode: r.mode,
    cwd: r.cwd,
    pid: 0,
    startedAt: r.startedAt,
    accountId: r.accountId || '',
    sessionId: r.sessionId || '',
    customAgentId: r.customAgentId || '',
    ownedByUser: !!r.ownedByUser,
    resumable,
    lastOutputAt: r.lastOutputAt || 0,
    exitCode: r.exitCode ?? null,
    running: false,
    saved: true,
    interrupted: !!(r.running || r.interrupted),
    buffer,
  };
}

function saved(paneId) {
  const r = store.get(paneId);
  return r
    ? savedInfo(
        paneId,
        r,
        checkResumable({ ...r, exitCode: r.exitCode ?? null }),
        tail(store.readScrollback(paneId))
      )
    : null;
}

// The same for the UI's pty:replay: the transcript lookup and the scrollback read don't block the
// main process (and every other IPC reply).
async function savedAsync(paneId) {
  const r = store.get(paneId);
  if (!r) return null;
  const [resumable, buffer] = await Promise.all([
    checkResumableAsync({ ...r, exitCode: r.exitCode ?? null }),
    store.readScrollbackAsync(paneId),
  ]);
  return savedInfo(paneId, r, resumable, tail(buffer));
}

// Output still waiting in the 16 ms batch is left out: it arrives as pty:data after this reply, so
// a view that writes the replay and then live data shows it once.
const liveReplay = s => ({
  ...publicInfo(s),
  cols: s.proc?.cols || 0,
  rows: s.proc?.rows || 0,
  buffer: s.pending ? s.buffer.slice(0, Math.max(0, s.buffer.length - s.pending.length)) : s.buffer,
});

module.exports = {
  init(sender) {
    send = sender;
    store.init();
  },
  start,
  panelEnvironment,
  // pty:stop from the UI also cancels a start still on its way (see generations).
  stop(paneId, reason) {
    cancel(paneId);
    return stop(paneId, reason);
  },
  generation,
  write(paneId, data) {
    const s = sessions.get(paneId);
    if (s && s.exitCode === null) s.proc.write(String(data));
  },
  resize(paneId, cols, rows) {
    const s = sessions.get(paneId);
    if (!s || s.exitCode !== null) return;
    cols = Math.max(20, cols | 0);
    rows = Math.max(5, rows | 0);
    if (cols === s.proc.cols && rows === s.proc.rows) return;
    try {
      s.proc.resize(cols, rows);
      emit(s, sizeMark(cols, rows));
    } catch {}
  },
  list() {
    return [...sessions.values()].map(publicInfo);
  },
  replay(paneId) {
    const s = sessions.get(paneId);
    return s ? liveReplay(s) : saved(paneId);
  },
  // pty:replay: a pane that started while the saved record was read replies with its live output
  // instead.
  async replayAsync(paneId) {
    const s = sessions.get(paneId);
    if (s) return liveReplay(s);
    const info = await savedAsync(paneId),
      now = sessions.get(paneId);
    return now ? liveReplay(now) : info;
  },
  // The pane was closed in the UI: end its process and drop its saved record and output.
  forget(paneId) {
    cancel(paneId);
    stop(paneId);
    store.forget(paneId);
    return true;
  },
  stopAll() {
    try {
      unwarm();
    } catch {}

    // one panel that throws never leaves the others unsaved
    for (const id of [...sessions.keys()])
      try {
        stop(id, 'quit');
      } catch {}
  },
  warm,
  unwarm,
  adopt,
  readyInfo,
};
