/*
 * Technically Not desktop · agent-shim.js — Runs behind the PATH shims Technically Not puts first
 * on every terminal pane's PATH (claude.cmd, codex.cmd, cursor-agent.cmd, opencode.cmd, tnai.cmd,
 * tnai). `claude` / `codex` / `cursor-agent` / `opencode` typed by hand: tells Technically Not
 * (agent-mesh.js, loopback + the pane's token) so the pane registers as a live agent session and
 * gets Technically Not's launch additions (Claude Code hooks, work rules), then runs the real CLI
 * on the pane's console; the open connection is the registration. `tnai agents | send | read |
 * context`: talks to the other agents in the same project; `tnai skill save | list`: Technically
 * Not's skill library; `tnai preview URL [device]` / `tnai preview close [URL]`: a localhost page
 * in Live preview; `tnai shot preview [URL] [device]`: a PNG of it to look at; `tnai ask | server |
 * test | tasks`: wait for an answer, dev server owners, one test run at a time (run here), shared
 * to-do board.Plain Node, no dependencies: Technically Not copies this file to userData/agent-shims
 * and runs it with its own executable (ELECTRON_RUN_AS_NODE). Without Technically Not (no token or
 * no answer) the real CLI just runs unchanged.
 */
'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const [, , command = '', ...args] = process.argv;
const token = process.env.TNAI_PANE_TOKEN || '';
const port = Number(process.env.TNAI_MESH_PORT) || 0;

// the real CLI (and anything it starts) must not inherit Technically Not's node mode
delete process.env.ELECTRON_RUN_AS_NODE;

// One JSON line to Technically Not, one JSON line back. keep: the connection stays open (a
// registered launch ends when it closes).
function ask(message, keep = false) {
  return new Promise((resolve, reject) => {
    if (!token || !port) return reject(new Error('not started by Technically Not'));
    const socket = net.connect(port, '127.0.0.1');
    let buffer = '',
      done = false;
    const fail = error => {
      if (!done) {
        done = true;
        socket.destroy();
        reject(error);
      }
    };

    // A launch waits longer: Technically Not first prepares skills, hooks and the project
    // (agent-mesh.js launch), which can take several seconds on a cold start. ask: the answer may
    // take the whole wait; test: the turn may wait behind other agents' runs.
    const timer = setTimeout(
      () => fail(new Error('Technically Not did not answer')),
      message.op === 'test'
        ? 3600000
        : message.op === 'ask'
          ? (Math.min(600, Number(message.wait) || 300) + 20) * 1000
          : message.op === 'graph'
            ? (message.action === 'wait'
                ? Math.min(600, Number(message.args?.timeout_seconds) || 600) + 30
                : 90) * 1000
            : keep
              ? 20000
              : message.op === 'send' ||
                  message.op === 'new' ||
                  message.op === 'preview' ||
                  message.op === 'show'
                ? 15000
                : message.op === 'intervene'
                  ? 25000
                  : message.op === 'shot'
                    ? 30000
                    : 5000
    );
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(JSON.stringify({ token, ...message }) + '\n'));
    socket.on('data', chunk => {
      if (done) return;
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      done = true;
      clearTimeout(timer);
      let reply;
      try {
        reply = JSON.parse(buffer.slice(0, end));
      } catch {
        reply = { ok: false, error: 'Unreadable answer from Technically Not.' };
      }
      if (!keep) socket.end();
      resolve({ reply, socket });
    });
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('Technically Not closed the connection')));
  });
}

// The real CLI: the first match on PATH after the shim folder, in the order the shell itself would
// find it. Windows: PATHEXT extensions, case-insensitive folders. mac/Linux: the bare name with the
// executable bit, as the shell finds it.
function findReal(name) {
  const win = process.platform === 'win32';
  const fold = p => (win ? path.resolve(p).toLowerCase() : path.resolve(p));
  const self = fold(__dirname);
  const exts = win
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of (process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    if (!dir || fold(dir) === self) continue;
    for (const ext of exts) {
      const file = path.join(dir, name + ext.toLowerCase());
      try {
        if (fs.statSync(file).isFile() && (win || (fs.accessSync(file, fs.constants.X_OK), true)))
          return file;
      } catch {}
    }
  }

  // A panel opened before Antigravity was installed has the old PATH; its installer puts agy.exe
  // here (same rule as agent-registry.js INSTALLED_AT).
  const known =
    win && name === 'agy' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')
      : '';
  if (known && fs.existsSync(known)) return known;
  return '';
}

// The pane's console input for the CLI: this process runs under a GUI-subsystem executable whose
// own stdin is not the console, so a CLI that inherited it would see no terminal. A piped or
// redirected stdin is passed on as it is.
function stdinFor() {
  // mac/Linux: stdin already is the terminal panel's tty
  if (process.platform !== 'win32') return 'inherit';
  try {
    const st = fs.fstatSync(0);
    if (st.isFIFO() || st.isFile()) return 'inherit';
  } catch {}
  try {
    return fs.openSync('\\\\.\\CONIN$', 'r+');
  } catch {
    return 'inherit';
  }
}

// .cmd/.bat need one pre-quoted cmd.exe command line (same rule as agent-registry.js launchSpec),
// .exe gets normal arguments. Each argument is quoted for the CLI's parser and its cmd
// metacharacters caret-escaped twice (cmd /c, then the shim's %*); cmd.exe ends a command at a line
// break, so line breaks inside an argument become spaces there.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const cmdArg = a =>
  (
    '"' +
    String(a)
      .replace(/\r?\n/g, ' ')
      .replace(/(\\*)"/g, '$1$1\\"')
      .replace(/(\\*)$/, '$1$1') +
    '"'
  )
    .replace(CMD_META, '^$1')
    .replace(CMD_META, '^$1');

// npm's generated .cmd shim (`"%dp0%\node_modules\...\cli.js|.exe" %*`) runs its program directly
// (a .js through node), so Technically Not's long work-rules argument skips cmd.exe's 8191-char
// line limit. Null for any other .cmd. Same rule as agent-registry.js npmTarget.
function npmTarget(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const m = text.match(/"%dp0%\\([^"%]+\.(js|exe))"\s+%\*\s*$/i);
  if (!m) return null;
  const dir = path.dirname(file),
    target = path.join(dir, m[1]);
  if (!fs.existsSync(target)) return null;
  if (m[2].toLowerCase() === 'exe') return { file: target, pre: [] };
  const node = [dir, ...(process.env.PATH || process.env.Path || '').split(path.delimiter)]
    .filter(Boolean)
    .map(d => path.join(d, process.platform === 'win32' ? 'node.exe' : 'node'))
    .find(f => fs.existsSync(f));
  return node ? { file: node, pre: [target] } : null;
}

function run(file, argv, env) {
  const options = { stdio: [stdinFor(), 'inherit', 'inherit'], env: { ...process.env, ...env } };
  const npm = /\.cmd$/i.test(file) ? npmTarget(file) : null;
  if (npm) return spawn(npm.file, [...npm.pre, ...argv], options);
  if (!/\.(cmd|bat)$/i.test(file)) return spawn(file, argv, options);
  const line = '""' + file + '"' + argv.map(a => ' ' + cmdArg(a)).join('') + '"';
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

async function launchAgent() {
  const real = findReal(command);
  if (!real) {
    process.stderr.write(command + ': the real CLI was not found on PATH.\n');
    process.exit(1);
  }
  let extra = [],
    env = {},
    socket = null;
  try {
    const { reply, socket: s } = await ask(
      {
        op: 'launch',
        agent: command,
        args,
        cwd: process.cwd(),
        codexHome: process.env.CODEX_HOME || '',
      },
      true
    );
    socket = s;
    if (reply.ok && reply.register) {
      extra = Array.isArray(reply.args) ? reply.args.map(String) : [];
      env = reply.env && typeof reply.env === 'object' ? reply.env : {};
    } else socket.end();
  } catch {}
  socket?.on('error', () => {});

  // The CLI handles Ctrl+C itself; this wrapper must not die from it and leave the CLI orphaned.
  process.on('SIGINT', () => {});
  process.on('SIGBREAK', () => {});
  const child = run(real, [...extra, ...args], env);
  child.on('error', error => {
    process.stderr.write(command + ': ' + error.message + '\n');
    socket?.end();
    process.exit(1);
  });
  child.on('exit', code => {
    socket?.end();
    process.exit(code ?? 1);
  });
}

const USAGE = [
  'tnai: talk to the other AI agents working in this project inside Technically Not.',
  '  tnai agents [--all]          list the live agents in this project (and the latest closed ones that can be revived; --all: every closed one)',
  "  tnai send NAME|ID message... type a message into that agent's input (a closed agent is revived first)",
  '  tnai send NAME -             the message from a pipe, for text with <, > or double quotes (Windows cmd.exe breaks those as arguments):',
  '                               \'text with <x> and "quotes"\' | tnai send NAME -   (tnai intervene NAME - and tnai ask NAME - too)',
  '  tnai new claude|codex|opencode|cursor task...   start a fresh agent in a new panel (it can have its own sub-agents) and give it the task; use your own CLI unless the user named another',
  '    --model NAME --effort LEVEL   (before the task) start it on that model / effort when the user asked for one, e.g. --model "Opus 5.5" --effort high',
  '    --name NAME                (before the task) only when the user named the new agent: that exact name, e.g. --name "bug reporter"',
  '  tnai intervene NAME message...   urgent only: stop a working agent where it is and hand it the message now (tnai send waits behind its task);',
  '                               it decides what to do with it. Once per agent every 2 min; never for status, thanks or things that can wait',
  '  tnai read NAME [lines]      show the last lines of its output (default 40, max 200)',
  '  tnai delegate [--agent CLI] [--name NAME] [--model M] [--effort E] [--worktree own|none] task...   hand one separate part of your task to a sub-agent (like the tnai_delegate tool; for leads without it)',
  '  tnai wait [ID...] [SECONDS]   wait for your sub-agents to finish and print their reports (default: all working ones, up to 600 s)',
  '  tnai subagents   list your sub-agents and their reports    ·    tnai assign ID task...   a follow-up task for one idle sub-agent',
  '  tnai ask NAME [--wait SEC] question...   send a question and wait for the answer (default 300 s, max 600); the agent answers with tnai send YOURNAME,',
  '                               which comes straight back here; after the wait, a late answer arrives in your input as a normal message',
  '  tnai close NAME|ID...        close offline or idle agents that are no longer needed, several at once (their work stays in tnai context)',
  '    --quiet-over MIN           also close every such agent quiet for MIN minutes or more',
  '    --user                     the user asked for it: agents the user started and sub-agents may be closed too (never busy ones or you)',
  '  tnai close --self            the user told you to close yourself: your panel closes a moment later, like its Close button',
  '    --successor NAME|ID        you handed your work to that agent: you retire, and messages sent to you go to it instead of reviving you',
  '  tnai rename NAME...          the user asked you to rename yourself: your panel takes that name (short, saying what you work on), everywhere it shows',
  '  tnai clear-closed [--older-than DAYS]   only when the user asks: remove closed agents from the `tnai agents` list (they can no longer be revived; work stays in tnai context)',
  '  tnai context [TOPIC...]      finished work of the agents in this project (new for you first; --all: more, in full), or matching a topic/file',
  '  tnai context brief           the standing brief: who is working, what is proven, what is open, and one next step',
  '  tnai context show ID         one finished result in full, and where its full terminal output is',
  '  tnai context note list|add TEXT|set KEY TEXT|remove ID   the project notes kept for this project (goals, constraints, current state)',
  "  tnai context mark done|dismissed|undo KEY|RESULTID...   resolve open items (KEY as listed by tnai context); decisions stay the user's",
  '  tnai context mark claimed KEY...     say you are fixing an item so other agents skip it (undo releases it)',
  '  tnai lock FILE...            hold files before editing them so no other agent edits them at once (refused, naming the holder, when another agent holds one; Claude Code locks by itself)',
  '  tnai unlock [FILE...]        let go of your file locks (all of them without FILE) once you are done with them',
  '  tnai locks                   which files are locked in this project, and by whom',
  '  tnai server [list]           localhost dev servers in this project, who owns each and whether it runs (reuse one instead of starting a copy)',
  "  tnai server claim URL        record that you own the dev server you started (refused, naming the owner, when another agent's runs there)",
  '  tnai server release [URL]    you stopped it (all of yours without URL); `tnai preview URL` records ownership by itself',
  "  tnai test [COMMAND...]       run the project's tests (found from package.json, pytest, cargo, go, dotnet, make…, or COMMAND) one agent at a time",
  "                               on this computer; prints pass/fail and, on failure, only the last lines; exits with the tests' exit code",
  "  tnai tasks [list]            the project's shared to-do board: open tasks, free or taken by whom",
  '  tnai tasks add TEXT | take ID | release ID | done ID   add a task, take one to work on, give it back, or mark it done',
  '  tnai team                    your team, if the user set one (teammates share file locks); the user groups agents with tnai team NAME NAME... in a plain terminal panel',
  "  tnai skill list              skills in Technically Not's library, this project and ~/.claude/skills (check before writing a new one)",
  "  tnai preview URL [phone|tablet|desktop]   show a running localhost dev server to the user in Technically Not's Live preview (no device: picked from the project)",
  '  tnai preview close [URL]                  close the Live preview tab(s) you opened (all of yours, or the one at URL), e.g. once you stop its server',
  '  tnai show FILE.html [phone|tablet|desktop]   show one HTML file of this project in Live preview without a server (a chart, a table, a mock-up); it must hold everything itself: no other file, no network',
  '  tnai shot preview [URL] [phone|tablet|desktop]   save a PNG of that localhost page (default: the Live preview tab you opened, else the active one) and print its path, to look at the UI you built',
  "  tnai skill save PATH [--distinct]   save a folder with SKILL.md (or a SKILL.md file; needs name + description frontmatter) to Technically Not's skill library, off until the user turns it on;\n" +
    '                               refused when it covers the same topic as a library skill (merge into that one), unless --distinct',
  '  tnai skill match TEXT        which skills Technically Not would name for a sentence the user might say (test that a skill you wrote is picked up)',
  '  tnai skill overlaps [PATH]   groups of library / project skills on the same topic (to merge), or which skills one SKILL.md overlaps',
  "  tnai skill remove NAME      remove an agent-written library skill that a merge replaced (the user's own skills: ask the user)",
].join('\n');

// `tnai test`: the project's own test command, found from the caller's folder up to the repository
// root (the first folder with a known setup wins).
function findTests(start) {
  const has = (dir, name) => fs.existsSync(path.join(dir, name));
  const text = (dir, name) => {
    try {
      return fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      return '';
    }
  };
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    let pkg = null;
    try {
      pkg = JSON.parse(text(dir, 'package.json'));
    } catch {}
    const npmTest = pkg?.scripts?.test;
    if (npmTest && !/no test specified/.test(npmTest))
      return {
        dir,
        cmd: has(dir, 'pnpm-lock.yaml')
          ? 'pnpm test'
          : has(dir, 'yarn.lock')
            ? 'yarn test'
            : has(dir, 'bun.lockb') || has(dir, 'bun.lock')
              ? 'bun run test'
              : 'npm test',
      };
    if (has(dir, 'Cargo.toml')) return { dir, cmd: 'cargo test' };
    if (has(dir, 'go.mod')) return { dir, cmd: 'go test ./...' };
    if (
      has(dir, 'pytest.ini') ||
      /\[tool\.pytest|pytest/.test(
        text(dir, 'pyproject.toml') + text(dir, 'setup.cfg') + text(dir, 'tox.ini')
      )
    )
      return { dir, cmd: 'python -m pytest' };
    if (has(dir, 'gradlew') || has(dir, 'gradlew.bat'))
      return { dir, cmd: process.platform === 'win32' ? 'gradlew.bat test' : './gradlew test' };
    if (has(dir, 'pom.xml')) return { dir, cmd: 'mvn test' };
    try {
      if (fs.readdirSync(dir).some(f => /\.(sln|csproj|fsproj)$/i.test(f)))
        return { dir, cmd: 'dotnet test' };
    } catch {}
    if (/^test:/m.test(text(dir, 'Makefile'))) return { dir, cmd: 'make test' };
    if (has(dir, '.git') || path.dirname(dir) === dir) return null;
  }
}
const TEST_MAX_MS = 30 * 60000,
  TEST_TAIL = 40;

async function runTests(words) {
  const found = words.length
    ? { dir: process.cwd(), cmd: words.join(' ') }
    : findTests(process.cwd());
  if (!found) {
    process.stderr.write(
      'tnai: no test setup found here (package.json "test" script, pytest, cargo, go, gradle, maven, dotnet or a Makefile test target). Run tnai test COMMAND.\n'
    );
    return 2;
  }
  let reply, socket;
  try {
    ({ reply, socket } = await ask({ op: 'test', cwd: process.cwd() }, true));
  } catch (error) {
    process.stderr.write('tnai: ' + error.message + '.\n');
    return 1;
  }
  if (!reply.ok) {
    socket?.destroy();
    process.stderr.write('tnai: ' + (reply.error || 'refused') + '\n');
    return 1;
  }
  socket.on('error', () => {});
  const started = Date.now();

  // CI=true: test runners skip watch mode and prompts. The output is kept (last 256 KB) and summed
  // up after the run, not streamed.
  const child = spawn(found.cmd, {
    cwd: found.dir,
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
  });
  let out = '';
  const keep = chunk => {
    out = (out + chunk).slice(-256 * 1024);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const killTree = () => {
    try {
      if (process.platform === 'win32')
        spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
          windowsHide: true,
          stdio: 'ignore',
        });
      else child.kill('SIGKILL');
    } catch {}
  };
  const limit = setTimeout(killTree, TEST_MAX_MS);
  const stop = () => {
    killTree();
    socket.end();
    process.exit(130);
  };
  process.on('SIGINT', stop);
  process.on('SIGBREAK', stop);
  const code = await new Promise(resolve => {
    child.on('error', e => {
      keep(String(e.message));
      resolve(1);
    });
    child.on('close', c => resolve(c ?? 1));
  });
  clearTimeout(limit);
  socket.end();
  const secs = Math.round((Date.now() - started) / 1000);
  const waited =
    reply.waited > 0
      ? ' (waited ' + reply.waited + ' s for ' + (reply.after.join(', ') || 'another run') + ')'
      : '';
  if (code === 0) {
    process.stdout.write('Tests passed · ' + found.cmd + ' · ' + secs + ' s' + waited + '\n');
    return 0;
  }
  const lines = out
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .filter(Boolean);
  process.stdout.write(
    'Tests FAILED (exit ' +
      code +
      (Date.now() - started >= TEST_MAX_MS ? ', stopped after 30 min' : '') +
      ') · ' +
      found.cmd +
      ' · ' +
      secs +
      ' s' +
      waited +
      '\nLast ' +
      Math.min(TEST_TAIL, lines.length) +
      ' lines:\n' +
      lines.slice(-TEST_TAIL).join('\n') +
      '\n'
  );
  return code || 1;
}

// A piped or redirected stdin as text; null when nothing was piped in (stdin is the console). The
// FIFO test reads the mode bits: on Windows Node's isFIFO() is false for a pipe whose mode says
// FIFO (Node 24, 2026-10-04).
function pipedText() {
  try {
    const st = fs.fstatSync(0);
    if ((st.mode & 0o170000) !== 0o010000 && !st.isFile()) return Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text.replace(/^\uFEFF/, '').replace(/\s+$/, '')));
    process.stdin.on('error', () => resolve(null));
  });
}

async function tnai() {
  const [sub = '', ...rest] = args;
  if (!sub || /^(help|-h|--help)$/.test(sub)) {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  if (!token || !port) {
    process.stderr.write(
      'tnai: this shell was not started by Technically Not, so it cannot reach other agents.\n'
    );
    return 2;
  }

  // `tnai send|intervene NAME -`: the message comes through stdin, so no shell parses it (tnai.cmd
  // hands %* to cmd.exe, where < > are redirection).
  if ((sub === 'send' || sub === 'intervene') && rest.length === 2 && rest[1] === '-') {
    const text = await pipedText();
    if (text === null) {
      process.stderr.write(
        'tnai: `tnai ' +
          sub +
          " NAME -` reads the message from a pipe: 'message' | tnai " +
          sub +
          ' NAME -\n'
      );
      return 2;
    }
    rest[1] = text;
  }

  // `tnai ask NAME [--wait SEC] -` the same way; --wait may also come after the dash.
  if (sub === 'ask' && rest.indexOf('-') >= 1) {
    const words = [...rest];
    const waitAt = words.indexOf('--wait');
    const wait = waitAt >= 0 ? words.splice(waitAt, 2)[1] : null;
    if (words.length === 2 && words[1] === '-') {
      const text = await pipedText();
      if (text === null) {
        process.stderr.write(
          "tnai: `tnai ask NAME -` reads the question from a pipe: 'question' | tnai ask NAME -\n"
        );
        return 2;
      }
      rest.splice(0, rest.length, words[0], ...(wait === null ? [] : ['--wait', wait]), text);
    }
  }
  let message;
  if (sub === 'agents' && (!rest.length || (rest.length === 1 && rest[0] === '--all')))
    message = { op: 'agents' };
  else if (sub === 'send' && rest.length >= 2)
    message = { op: 'send', to: rest[0], text: rest.slice(1).join(' ') };
  else if (sub === 'intervene' && rest.length >= 2)
    message = { op: 'intervene', to: rest[0], text: rest.slice(1).join(' ') };
  else if (sub === 'new' && rest.length >= 2) {
    // --model NAME / --effort LEVEL (also --model=NAME) before the task: the new agent starts on
    // them (desktop/model-pick.js checks the names).
    const pick = { model: '', effort: '', name: '' },
      words = rest.slice(1);
    while (words.length && /^--(model|effort|name)(=|$)/.test(words[0])) {
      const [flag, eq] = words.shift().slice(2).split(/=(.*)/s);
      pick[flag] = eq !== undefined ? eq : words.shift() || '';
    }
    message = { op: 'new', agent: rest[0], text: words.join(' '), ...pick };
  } else if (sub === 'read' && rest.length >= 1)
    message = { op: 'read', from: rest[0], lines: Number(rest[1]) || 40 };
  else if (sub === 'close' && rest.length >= 1) {
    const names = [],
      opts = { user: false, quietOver: 0, self: false, successor: '' };
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--user') opts.user = true;
      else if (rest[i] === '--self') opts.self = true;
      else if (rest[i] === '--quiet-over') opts.quietOver = parseFloat(rest[++i]) || 0;
      else if (/^--successor(=|$)/.test(rest[i]))
        opts.successor = rest[i].includes('=') ? rest[i].slice(12) : rest[++i] || '';
      else names.push(...rest[i].split(',').filter(Boolean));
    }
    if (
      (!names.length && !opts.quietOver && !opts.self) ||
      (opts.successor && (!opts.self || names.length))
    ) {
      process.stderr.write(USAGE + '\n');
      return 2;
    }
    message = { op: 'close', names, ...opts };
  } else if (sub === 'rename' && rest.length >= 1) message = { op: 'rename', name: rest.join(' ') };
  else if (
    sub === 'clear-closed' &&
    (!rest.length || (rest.length === 2 && rest[0] === '--older-than' && Number(rest[1]) >= 0))
  )
    message = { op: 'clear-closed', olderThanDays: Number(rest[1]) || 0 };
  else if (sub === 'context') message = { op: 'context', args: rest };
  else if (sub === 'ask') {
    const words = [...rest];
    let wait = 0,
      to = '';
    while (words.length && (!to || words[0] === '--wait')) {
      if (words[0] === '--wait') {
        words.shift();
        wait = Number(words.shift()) || 0;
      } else to = words.shift();
    }
    if (to && words.length) message = { op: 'ask', to, text: words.join(' '), wait };
    else {
      process.stderr.write(USAGE + '\n');
      return 2;
    }
  } else if (sub === 'server' && (!rest.length || rest[0] === 'list') && rest.length <= 1)
    message = { op: 'server', action: 'list' };
  else if (
    sub === 'server' &&
    ['claim', 'release'].includes(rest[0]) &&
    rest.length <= 2 &&
    (rest[0] === 'release' || rest[1])
  )
    message = { op: 'server', action: rest[0], url: rest[1] || '' };
  else if (sub === 'tasks') message = { op: 'tasks', args: rest };

  // Sub-agents from the shell (agent-graph.js, the same calls as the tnai_delegate / tnai_wait /
  // tnai_subagents / tnai_assign tools), for a lead whose CLI can't reach Technically Not's MCP
  // server.
  else if (sub === 'delegate' && rest.length >= 1) {
    const opt = { purpose: '', name: '', agent: '', model: '', effort: '', worktree: '' },
      words = [...rest];
    while (words.length && /^--(purpose|name|agent|model|effort|worktree)(=|$)/.test(words[0])) {
      const [flag, eq] = words.shift().slice(2).split(/=(.*)/s);
      opt[flag] = eq !== undefined ? eq : words.shift() || '';
    }
    const task = words.join(' ').trim();
    if (task)
      message = {
        op: 'graph',
        action: 'delegate',
        args: {
          task,
          purpose: opt.purpose || task.split(/\s+/).slice(0, 6).join(' '),
          why: 'Delegated with `tnai delegate` from the shell.',
          ...Object.fromEntries(Object.entries(opt).filter(([k, v]) => v && k !== 'purpose')),
        },
      };
    else {
      process.stderr.write(USAGE + '\n');
      return 2;
    }
  } else if (sub === 'wait' && rest.every(a => /^[\w-]+$/.test(a))) {
    const secs = rest.find(a => /^\d{1,3}$/.test(a)),
      // seconds (≤ 600) vs 8-character ids, which can be all digits
      ids = rest.filter(a => a !== secs);
    message = {
      op: 'graph',
      action: 'wait',
      args: { ...(ids.length ? { ids } : {}), ...(secs ? { timeout_seconds: Number(secs) } : {}) },
    };
  } else if (sub === 'subagents' && !rest.length)
    message = { op: 'graph', action: 'subagents', args: {} };
  else if (sub === 'assign' && rest.length >= 2)
    message = {
      op: 'graph',
      action: 'assign',
      args: { id: rest[0], task: rest.slice(1).join(' ') },
    };
  else if (sub === 'test') return runTests(rest);
  else if (sub === 'lock' && rest.length >= 1) message = { op: 'lock', files: rest };
  else if (sub === 'unlock') message = { op: 'unlock', files: rest };
  else if (sub === 'locks') message = { op: 'locks' };
  else if (sub === 'team')
    message = { op: 'team', names: rest.flatMap(w => w.split(',')).filter(Boolean) };
  else if (sub === 'preview' && rest[0] === 'close' && rest.length <= 2)
    message = { op: 'preview', close: true, url: rest[1] || '' };
  else if (sub === 'preview' && rest.length >= 1 && rest.length <= 2)
    message = { op: 'preview', url: rest[0], device: rest[1] || '' };
  else if (sub === 'show' && rest.length >= 1 && rest.length <= 2)
    message = { op: 'show', file: rest[0], device: rest[1] || '' };
  else if (sub === 'shot' && rest[0] === 'preview' && rest.length <= 3) {
    // [URL] [device] in either order; a lone word that is a device view is the device.
    const words = rest.slice(1),
      dev = words.find(w => /^(phone|tablet|desktop)$/i.test(w)) || '',
      other = words.filter(w => w !== dev);
    if (other.length > 1) {
      process.stderr.write(USAGE + '\n');
      return 2;
    }
    message = { op: 'shot', url: other[0] || '', device: dev.toLowerCase() };
  } else if (sub === 'skill' && rest[0] === 'list') message = { op: 'skill', action: 'list' };
  else if (
    sub === 'skill' &&
    rest[0] === 'save' &&
    rest.filter(a => a !== '--distinct').length >= 2
  )
    message = {
      op: 'skill',
      action: 'save',
      path: rest
        .slice(1)
        .filter(a => a !== '--distinct')
        .join(' '),
      distinct: rest.includes('--distinct'),
    };
  else if (sub === 'skill' && rest[0] === 'match' && rest.length >= 2)
    message = { op: 'skill', action: 'match', text: rest.slice(1).join(' ') };
  else if (sub === 'skill' && rest[0] === 'overlaps')
    message = { op: 'skill', action: 'overlaps', path: rest.slice(1).join(' ') };
  else if (sub === 'skill' && rest[0] === 'remove' && rest.length === 2)
    message = { op: 'skill', action: 'remove', name: rest[1] };
  else {
    process.stderr.write(USAGE + '\n');
    return 2;
  }
  let reply;
  try {
    ({ reply } = await ask({ ...message, cwd: process.cwd() }));
  } catch (error) {
    process.stderr.write('tnai: ' + error.message + '.\n');
    return 1;
  }
  if (!reply.ok) {
    process.stderr.write('tnai: ' + (reply.error || 'refused') + '\n');
    return 1;
  }
  if (sub === 'agents') {
    const rows = reply.agents || [];
    process.stdout.write('Agents in ' + reply.project + ' (' + rows.length + '):\n');
    for (const a of rows)
      process.stdout.write(
        '  ' +
          [
            a.name + (a.you ? ' (you)' : ''),
            a.provider,
            'id ' + (a.id || a.pane),
            a.status +
              (a.quietMin != null ? ', quiet ' + a.quietMin + ' min' : '') +
              (a.userStarted ? ', started by the user' : ''),
            a.task || '-',
          ].join('  ·  ') +
          '\n'
      );

    // Agents on a paired computer that takes messages from this computer's agents.
    // Names and the computer's name are already held to plain
    // characters by the app; nothing of their tasks is printed.
    for (const c of Array.isArray(reply.far) ? reply.far : []) {
      process.stdout.write(
        'On ' +
          c.computer +
          ", another of the user's computers, in this project (" +
          c.rows.length +
          '). Only for a task the user gave you: `tnai ask NAME@COMPUTER QUESTION` waits for the answer, `tnai send NAME@COMPUTER MESSAGE` does not:\n'
      );
      for (const a of c.rows)
        process.stdout.write(
          '  ' +
            [a.addr, a.cli, a.status, a.ask ? 'can be asked' : 'cannot be messaged from here'].join(
              '  ·  '
            ) +
            '\n'
        );
    }
    const offline = reply.offline || [];
    if (offline.length)
      process.stdout.write(
        'Offline in open panels (left over or stopped): `tnai send NAME message` resumes one, `tnai close NAME` closes it (' +
          offline.length +
          '):\n'
      );
    for (const a of offline)
      process.stdout.write(
        '  ' +
          [a.name, a.agent, 'panel ' + a.pane, 'last task: ' + (a.task || '-')].join('  ·  ') +
          '\n'
      );
    const closed = reply.closed || [];
    if (closed.length)
      process.stdout.write('Closed, revived by `tnai send ID message` (' + closed.length + '):\n');

    // short by default (usage: the list stays in the agent's context); --all: every one
    const shown = rest[0] === '--all' ? closed : closed.slice(-10);
    for (const a of shown)
      process.stdout.write(
        '  ' +
          [
            a.name,
            a.agent,
            'id ' + a.id,
            ...(a.successor ? ['retired: messages go to ' + a.successor] : []),
            'last task: ' + (a.task || '-'),
          ].join('  ·  ') +
          '\n'
      );
    if (shown.length < closed.length)
      process.stdout.write(
        '  … ' + (closed.length - shown.length) + ' more closed: `tnai agents --all` lists them\n'
      );
  } else if (sub === 'send' || sub === 'new')
    process.stdout.write((reply.queued ? 'Queued for ' : 'Sent to ') + reply.to + '.\n');
  else if (sub === 'close') process.stdout.write('Closed ' + reply.to + '.\n');
  else process.stdout.write(reply.text + (reply.text.endsWith('\n') ? '' : '\n'));
  return 0;
}

// exitCode, not exit(): console output is asynchronous on Windows and would be cut off.
if (command === 'tnai')
  tnai().then(code => {
    process.exitCode = code;
  });
else launchAgent();
