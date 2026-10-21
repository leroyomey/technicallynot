/*
 * * Technically Not tools · desktop-check/remote-check.js — the two-app check for "several
 * computers".
 * * Two real app instances (A and B, throwaway profiles)
 * * signed in to one account on a LOCAL accounts server (`wrangler dev`, relay switched on;
 * * started by its own script), driven through tests/remote-two.main.js. Eight proofs, one
 * * ok/FAIL line each (5 and 6 added 2026-10-09, between the ones numbered 4 and 5 below: A's
 * agents
 * * on B follow the project open on B; and B says A has this project, a commit
 * * on A shows, the first switch on A takes project and keys away, 6d. The last two are now 7 and
 * 8):
 * * 1. remote off in both: no relay socket, no ticket asked, no tnai-remote.bin in either profile
 * * 2. both turned on, nothing paired: each app asks one ticket and opens one socket, and the relay
 * * lists both online (since 0.3.66 a computer with several computers switched on stays connected
 * * with nothing paired, so another computer of the account can ask it to pair:
 * * `hear` in desktop/remote-link.js); neither lists a paired computer, neither has a
 * * session. REWRITTEN 2026-10-10 from the 0.3.65 form ("still no socket"), NOT YET RUN in this
 * form.
 * * 3. pairing through the real remote:* calls (B pairAny, A pair(B), the two codes typed both
 * ways):
 * * both list the other with a live session
 * * 4. a "needs you" item on A shows in B's state with the agent's name; cleared on A, it clears on
 * B
 * * 5. A quits: B shows it offline with a last-heard time and no waiting item; A starts again: the
 * * session is back within 30 s
 * * 6. remote off on B: its socket closes, the pairing is kept Then full control
 * * (the "full control" switch and its operations; added
 * * 2026-10-09), proofs 9 to 22 (about 5 minutes in all: a start is limited to 3 a minute, so the
 * * last proofs wait for the first ones to age out):
 * * 9. the switch off (the default): nothing to press on A, no ticket leaves B, and a prompt a
 * * changed A sends anyway gets no reply
 * * 10. switched on on B: a prompt from A reaches the agent's terminal on B once (one paste, one
 * * Enter) and A reads a fixed word
 * * 11. a prompt that starts with "!" is refused before anything is written
 * * 12. a PowerShell panel and a CLI typed by hand get no ticket, and an operation for one with the
 * * agent's ticket is refused
 * * 13. control turned off on B while a prompt is held there: it is dropped and A is told; from
 * then
 * * on A gets no reply
 * * 14. an interrupt writes Esc and nothing else
 * * 15. a stop ends the agent's process; a second stop is refused
 * * 16. a start from A with the same project open on both: one agent panel opens on B, its first
 * * prompt arrives once, A reads "started"
 * * 17. that agent runs at "Ask first" although B's project is set to Full access (test
 * * 18)
 * * 18. another project open on B: refused, no panel
 * * 19. control switched off on B while the start waits on B's folder-trust question, which names
 * A:
 * * no process starts (test 20)
 * * 20. three panels started from A are open on B, one of them without a process: the fourth is
 * * refused (test 17)
 * * 21. B's workspace is full: no panel and no new workspace
 * * 22. the panel of proof 16 is started again on B (as its user would, with Full access asked):
 * * resumed or fresh, it is "Ask first" again (a resume was refused
 * * until 2026-10-10 and is now held with the flag on it)
 * * 27. a picture and a text file with a prompt,
 * * before the reports proof, which is now 28 and stays the last: in A's window two chips
 * * are prepared by the page and sent; B holds the same bytes under its own names, its agent's
 * prompt
 * * names both paths. The agent is this proof's own stand-in, started idle. First passed 2026-10-10
 * * (the files and the prompt took 50 s for a 98 KB picture and a note).
 * * 23. the live view: A watches
 * * that agent's terminal panel on B and its picture is, row for row, what B's own window reads
 * from
 * * that panel; a still screen brings no new picture in 10 seconds; the agent is restarted: "gone";
 * * watched again, then full control goes off on B: "off" and the picture is dropped. First run
 * * 2026-10-10 by the lead: passed. The stand-in CLI is unchanged; the terminal, the reading of its
 * * screen, the frames, the checks and the picture are the two apps'.
 * * 24. another computer's agents in the thread list, in A's own
 * * window, read and pressed as its user would (tests/remote-two.main.js `farAgents`): B's agent of
 * * the open project is listed under B's name and nothing is watched; its row selected, the page's
 * * terminal box shows, row for row, what B's own window reads from that panel; "Send composer
 * tasks
 * * here" and the composer's Send bring one prompt to that agent; the page left, the view is gone
 * on
 * * B; full control off, the composer lets the agent go; watched once more from the page, A's
 * window
 * * is loaded again (`reload`) and B is no longer watched. No message of its
 * * own. WRITTEN 2026-10-10 AND NOT YET RUN (the two-window try was open).
 * * 25. a longer command answered from the other computer (remote-protocol.md 6f point 5, changes 7
 * * and 8): A holds a shell request of three lines and lets B answer; B's state carries every line
 * as
 * * `full` with `can2` and never `can`; B's Allow once reaches that request, once; with A's answer
 * * switch off a second such command arrives without its text. WRITTEN 2026-10-10, NOT YET RUN.
 * * 28. agents messaging agents:
 * * while the piece is switched off, the window cannot give the right and a `say` sent
 * * anyway is dropped unread; once it can be given, the message is written with B's mark and fixed
 * * line, answered `said` and listed. WRITTEN 2026-10-10, NOT YET RUN. In the run it is proof 28
 * and
 * * the reports proof below is 29 (the numbers in this list fell behind the run's own as proofs
 * were
 * * added).
 * * 29 in the run (added 2026-10-15). the rename limit: with full control on, B's agent runs
 * * `tnai rename` (the real shim against B's mesh, run by the check as that agent) once, and a
 * * second rename inside the minute is refused; with full control off it goes through. The
 * * reports proof after it is 30.
 * * 31 in the run (added 2026-10-15). late join: A reads the conversation of B's running agent
 * * after B's first switch goes on again. STAND-IN: the record of that conversation (the
 * * stand-in CLI writes none; tests/remote-two.main.js `talkSeed` answers the read for another
 * * computer and gives the panel a conversation id). The handle, the shaping, the cut at the
 * * pairing, the parts, the link, A's holding and A's read-only drawing are the two apps'.
 * * WRITTEN 2026-10-15, NOT YET RUN.
 * * 32 and 33 in the run (added 2026-10-15). late join: another project open on A hides B's
 * * agents with the "On B" line and refuses an ask; with the live view on, a minute of the most
 * * conversation asks A may make keeps B's trust gate under 116 messages in any minute
 * * (`sentMinute`, a tap on the trust gate in tests/remote-two.main.js). WRITTEN 2026-10-15, NOT
 * YET RUN.
 * * 26. a finished task's short result crosses (6g), and its answer's text is read through
 * * remote:reportText, not from the pushed state; it was 23, 24, then 25,
 * * as proofs came before it, and stays the last. In 16 to 21 the panels are real ones in B's
 * window,
 * * opened by the app's own path for a new agent (the lifecycle's request, the window,
 * `pty:start`);
 * * the folder-trust question is the app's own and is answered on B as its user would. Stand-ins
 * * there: the CLI (below), "ready" (the stand-in says so through the check, as the real CLI's
 * * connection to the app's tool server does), and in 21 the eleven or so empty panels that fill
 * the
 * * workspace. WHAT IS A STAND-IN in 9 to 21: the agent CLI. A real agent panel needs a signed-in
 * CLI
 * * and would spend the user's usage, so the program in B's agent panel is a plain Node script put
 * * first on PATH as `claude` (tests/remote-two.main.js, STAND_IN). It records every byte it is
 * sent
 * * and says "I took this prompt" when a pasted prompt is followed by Enter, as the real CLI's hook
 * * does. The "CLI typed by hand" is the roster being told so for the PowerShell panel (which is a
 * * real PowerShell). The "changed A" is the check sending messages of its own making through A's
 * own
 * * trust gate. Everything else is the two real apps: the panel is started by the app's
 * `pty:start`,
 * * and the roster, the task record, the ticket, the switch, the delivery, the Esc and the stop are
 * * the app's. BY HAND: node tools/desktop-check/remote-check.js hand (the two-window try; added
 * * 2026-10-09 so several computers can be tried on one PC before a release reaches a second one).
 * No
 * * proofs. It starts the same two copies on the same local relay, names them "Computer A" (left
 * half
 * * of the screen) and "Computer B" (right half), turns "several computers" on in both, pairs them
 * * with the two codes, opens one small git project in both (B's is a clone in another folder) and
 * * the Devices page, then leaves both windows to the person in front of them until both are closed
 * * (or Ctrl+C here). NO STAND-IN there: an agent started in either window is the REAL CLI
 * installed
 * * on this PC, signed in as the user and spending their usage, working in that throwaway project.
 * * The profiles are throwaway (run.js): Codex is signed out in them, the plan lock is off, the
 * * account is the local relay's test account. The windows draw as the installed app does and
 * nothing
 * * is answered for the person (run.js, TNAI_CHECK_BY_HAND). Full control is left off, as shipped:
 * * turning it on is part of the try. It holds the one-check-at-a-time line only until both windows
 * * are ready. Usage (from the project folder; Node 22+): node tools/desktop-check/remote-check.js
 * * Wrangler: WRANGLER_JS=<path to wrangler's bin/wrangler.js>, else `npx wrangler`. Nothing is
 * * deployed and no real account is touched. It waits in the same line as check.js (one desktop
 * check
 * * at a time on this PC) and stops both apps and the local server when it ends.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..', '..');
const HAND = process.argv[2] === 'hand';
const electron = require(path.join(root, 'node_modules', 'electron'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(what, fn, ms = 15000, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out: ' + what);
    await sleep(every);
  }
}

// ---- one desktop check at a time: the same lock file as check.js ----
const LOCK = path.join(os.tmpdir(), 'tnai-desktop-check.lock');
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

async function takeLock() {
  let told = false;
  for (;;) {
    try {
      fs.writeFileSync(
        LOCK,
        JSON.stringify({ pid: process.pid, tests: ['remote-check'], at: new Date().toISOString() }),
        { flag: 'wx' }
      );
      return;
    } catch {}
    let holder = null,
      folder = false;
    try {
      folder = fs.statSync(LOCK).isDirectory();
      if (!folder) holder = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    } catch {}
    if (folder) holder = { pid: '?', tests: ['a check started from PowerShell (lock folder)'] };
    else if (!holder || !alive(holder.pid)) {
      try {
        fs.unlinkSync(LOCK);
      } catch {}
      await sleep(200);
      continue;
    }
    if (!told) {
      console.log(
        `Waiting: another desktop check is running (pid ${holder.pid}: ${(holder.tests || []).join(' ')}). Checks run one at a time on this PC.`
      );
      told = true;
    }
    await sleep(3000);
  }
}

function dropLock() {
  try {
    if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === process.pid) fs.unlinkSync(LOCK);
  } catch {}
}

// ---- the two apps ----
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-remote-check-'));
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
const apps = [];
const killTree = child => {
  if (child.exitCode !== null || child.signalCode) return;
  try {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch {}
};

function makeApp(label, id) {
  const a = { label, id, profile: path.join(base, label), port: 0, child: null, out: '', pids: [] };
  apps.push(a);
  return a;
}

async function startApp(a, extraEnv) {
  a.port = await freePort();
  a.out = '';
  const env = {
    ...process.env,
    ...extraEnv,
    TNAI_SELFTEST: 'remote-two',
    TNAI_REMOTE_CHECK_PROFILE: a.profile,
    TNAI_REMOTE_CHECK_PORT: String(a.port),
    TNAI_HOME_SKILLS_DIR: path.join(base, 'home-skills'),
    ...(HAND ? { TNAI_CHECK_BY_HAND: '1' } : {}),
  };
  for (const k of ['TNAI_CHECK_LIMIT_MS', 'ELECTRON_RUN_AS_NODE', 'TNAI_CHECK_PROJECT'])
    delete env[k];

  // The second -r: the test's own main-process half, loaded before the app's code so it can see
  // what this app is sent (proofs 9 to 16).
  a.child = spawn(
    electron,
    [
      '-r',
      path.join(__dirname, 'remote-check-preload.js'),
      '-r',
      path.join(__dirname, 'tests', 'remote-two.main.js'),
      root,
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  a.pids.push(a.child.pid);
  const keep = d => {
    a.out = (a.out + d).slice(-6000);
  };
  a.child.stdout.on('data', keep);
  a.child.stderr.on('data', keep);
  const child = a.child;
  await until(
    a.label + ' is up',
    async () => {
      if (child.exitCode !== null)
        throw new Error(a.label + ' exited while starting (code ' + child.exitCode + ')');
      try {
        return (await call(a, 'ping')).ready;
      } catch {
        return false;
      }
    },
    90000,
    300
  );
  a.upAt = Date.now();
}

async function call(a, cmd, args) {
  const r = await fetch(`http://127.0.0.1:${a.port}/`, {
    method: 'POST',
    body: JSON.stringify({ cmd, args }),
    signal: AbortSignal.timeout(20000),
  });
  const out = await r.json();
  if (!out?.ok) throw new Error(a.label + ' ' + cmd + ': ' + (out?.error || 'failed'));
  return out.value;
}

// A real remote:* call from that app's window. → the value, or throws with the call's error code.
async function R(a, fn, ...args) {
  const r = await call(a, 'remote', { fn, args });
  if (!r?.ok) throw new Error(a.label + ' remote.' + fn + ' refused: ' + (r?.error?.code || '?'));
  return r.value;
}
const peerOf = (state, id) => state.computers.find(c => c.id === id) || null;

async function quitApp(a, ms = 15000) {
  const child = a.child;
  if (!child || child.exitCode !== null) return 'gone';
  let how = 'killed';
  try {
    how = await call(a, 'quit');
  } catch {}
  const end = Date.now() + ms;
  while (child.exitCode === null && Date.now() < end) await sleep(100);
  if (child.exitCode === null) {
    killTree(child);
    how = 'killed';
    await sleep(500);
  }
  return how;
}

// ---- results ----
let failed = 0;
const lines = [];

function say(n, ok, label, detail) {
  if (!ok) failed++;
  const line = (ok ? 'ok   ' : 'FAIL ') + n + '. ' + label + (detail ? '  [' + detail + ']' : '');
  lines.push(line);
  console.log(line);
}
const info = text => console.log('     ' + text);

let relay = null,
  cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const a of apps) await quitApp(a, 8000);
  try {
    relay?.stop();
  } catch {}
  await sleep(800);
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {}
  dropLock();
}
process.on('exit', () => {
  for (const a of apps) if (a.child) killTree(a.child);
  try {
    relay?.stop();
  } catch {}
  if (!cleaned)
    try {
      fs.rmSync(base, { recursive: true, force: true });
    } catch {}
  dropLock();
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try {
    process.on(sig, () => process.exit(130));
  } catch {}
}
let watchdog = null;

// Both apps started and signed in to one account on the local relay. X is a third computer of the
// account that only asks the relay who is connected (the proofs need it; by hand it is left out, or
// the Devices page would list a computer nobody has).
async function bringUp(third = true) {
  const idA = crypto.randomUUID(),
    idB = crypto.randomUUID(),
    idX = crypto.randomUUID();
  const A = makeApp('A', idA),
    B = makeApp('B', idB);
  const { startLocalRelay } = await import(
    pathToFileURL(path.join(root, 'server', 'api', 'tools', 'relay-local.mjs')).href
  );
  relay = await startLocalRelay(third ? [idA, idB, idX] : [idA, idB]);

  // The local server signs plan passes with its own test key (.dev.vars): the apps are given its
  // public half, as a local server needs.
  const vars = fs.readFileSync(path.join(root, 'server', 'api', '.dev.vars'), 'utf8');
  const passKey = crypto
    .createPublicKey(
      crypto.createPrivateKey({
        key: Buffer.from(/^PASS_SIGNING_KEY=(.*)$/m.exec(vars)[1].trim(), 'base64'),
        format: 'der',
        type: 'pkcs8',
      })
    )
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
  const appEnv = { TNAI_ACCOUNTS_URL: relay.BASE, TNAI_PASS_TEST_KEY: passKey };
  const user = { id: 'smoke-user', name: 'Smoke', email: 'smoke@relay.example', providers: [] };
  await startApp(A, appEnv);
  await startApp(B, appEnv);
  for (const a of [A, B]) {
    const s = await call(a, 'signIn', { token: relay.tokens[a.id], deviceId: a.id, user });
    if (!s.signedIn || s.device !== a.id)
      throw new Error(a.label + ' is not signed in: ' + JSON.stringify(s));
    info(
      a.label +
        ' signed in to the local account as ' +
        s.user +
        ', plan ' +
        (s.plan || '?') +
        (s.problem ? ', problem: ' + s.problem : '')
    );
  }
  return { A, B, idA, idB, idX, appEnv };
}

// Pairing through the real remote:* calls: B waits for any computer, A asks B, the two codes are
// typed both ways (never printed).
async function pairUp(A, B) {
  await R(B, 'pairAny');
  await until(
    'B connected in pairing mode',
    async () => (await R(B, 'state')).connection === 'online'
  );
  await R(A, 'pair', B.id);
  const first = await until(
    'A shows a code',
    async () => (await R(A, 'state')).pairing?.shows,
    20000
  );
  await until(
    'B asks for the code',
    async () => (await R(B, 'state')).pairing?.state === 'enter',
    20000
  );
  const e1 = await R(B, 'enterCode', first);
  const second = await until(
    'B shows the second code',
    async () => (await R(B, 'state')).pairing?.shows,
    20000
  );
  const e2 = await R(A, 'enterCode', second);
  let sa, sb;
  await until(
    'both list the other with a live session',
    async () => {
      sa = await R(A, 'state');
      sb = await R(B, 'state');
      return peerOf(sa, B.id)?.session && peerOf(sb, A.id)?.session;
    },
    30000
  );
  return { first, second, e1, e2, sa, sb };
}
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Check',
      GIT_AUTHOR_EMAIL: 'check@example.invalid',
      GIT_COMMITTER_NAME: 'Check',
      GIT_COMMITTER_EMAIL: 'check@example.invalid',
    },
  });
  if (r.status !== 0)
    throw new Error(
      'git ' +
        args[0] +
        ' failed: ' +
        String(r.stderr || r.error?.message || '')
          .trim()
          .slice(0, 200)
    );
  return r.stdout.trim();
};

// ---- by hand: two windows, paired, one project in both, then left to the person (see the header)
// ----
async function hand() {
  let ok = false;
  try {
    console.log('Starting a local relay and two copies of the app. This takes about a minute.');
    const { A, B } = await bringUp(false);
    await call(A, 'place', {
      side: 'left',
      title: 'Technically Not · Computer A (two-window try)',
    });
    await call(B, 'place', {
      side: 'right',
      title: 'Technically Not · Computer B (two-window try)',
    });
    await R(A, 'setOn', true);
    await R(B, 'setOn', true);
    await R(A, 'setName', 'Computer A');
    await R(B, 'setName', 'Computer B');
    await pairUp(A, B);

    // One small git project, the same in both: B's is a clone in another folder, as a second
    // computer's copy would be.
    const xA = path.join(base, 'files of A', 'try-project'),
      xB = path.join(base, 'files of B', 'try-project');
    fs.mkdirSync(xA, { recursive: true });
    fs.mkdirSync(path.dirname(xB), { recursive: true });
    fs.writeFileSync(
      path.join(xA, 'README.md'),
      '# Try project\n\nA throwaway project for trying several computers on one PC. It is deleted when both windows are closed.\n'
    );
    fs.writeFileSync(path.join(xA, 'notes.txt'), 'one\ntwo\nthree\n');
    git(xA, 'init', '-q');
    git(xA, 'add', '--', 'README.md', 'notes.txt');
    git(xA, 'commit', '-q', '-m', 'first');
    git(path.dirname(xB), 'clone', '-q', xA, xB);
    for (const [a, dir] of [
      [A, xA],
      [B, xB],
    ]) {
      const now = await call(a, 'project', { dir, ui: true });
      if (path.resolve(String(now || '')) !== path.resolve(dir))
        throw new Error(a.label + ' did not open the try project (it has ' + now + ')');
    }
    await call(A, 'page', { view: 'devices' });
    await call(B, 'page', { view: 'devices' });

    // the page has drawn: one picture of each window, so whoever started this can look before
    // handing over
    await sleep(1500);
    for (const a of [A, B])
      info(
        'picture of ' +
          a.label +
          ': ' +
          (await call(a, 'shot', { name: 'two-window-' + a.label.toLowerCase() }))
      );

    // other desktop checks may run again: from here on the two windows only wait for their user
    dropLock();
    ok = true;
    console.log(
      [
        '',
        'READY. Two windows are open and paired:',
        '  left:  Computer A',
        '  right: Computer B',
        'Both have the same small project open ("try-project") and show the Devices page.',
        'An agent you start in either window is the REAL CLI on this PC and uses your usage.',
        'Close both windows to end (or press Ctrl+C here). Everything is removed then.',
        '',
      ].join('\n')
    );
    for (;;) {
      if (apps.every(a => a.child.exitCode !== null)) break;
      await sleep(1000);
    }
  } catch (e) {
    console.log('FAIL the two windows could not be set up: ' + String(e.message || e));
    for (const a of apps)
      if (a.out.trim())
        console.log(
          '--- ' +
            a.label +
            ' output (end):\n' +
            a.out
              .trim()
              .split(/\r?\n/)
              .filter(l => l && !/DevTools|GPU|gpu_/.test(l))
              .slice(-12)
              .join('\n')
        );
  }
  const pids = apps.flatMap(a => a.pids);
  await cleanup();
  const left = pids.filter(alive);
  console.log(
    left.length
      ? 'FAIL app processes still running: ' + left.join(' ')
      : 'Both windows and the local relay are closed, and the throwaway project is deleted.'
  );
  process.exit(ok && !left.length ? 0 : 1);
}

(async () => {
  await takeLock();
  if (HAND) return hand();
  watchdog = setTimeout(() => {
    console.log('FAIL the whole check took more than 11 minutes: stopped');
    process.exit(1);
  }, 11 * 60e3); // the exit handler stops everything
  let A, B, idA, idB, idX, appEnv;
  const steps = [
    'remote off in both apps: no relay socket, no tnai-remote.bin',
    'both on, nothing paired: one ticket and one socket each, both online at the relay, nothing paired and no session',
    'paired with the two codes: both list the other with a live session',
    'a needs-you item on A shows on B with the agent name, and clears',
    "A's agents on B follow the project open on B: listed for that project, counted for the others, and they swap when B opens another",
    'B says A has this project; a commit on A shows; the first switch on A takes project and keys away',
    'A quits: B shows it offline, last heard, nothing waiting; A again: session back within 30 s',
    'remote off on B: its socket closes, the pairing is kept',
    'full control off (the default): nothing to press on A, no ticket from B, a prompt sent anyway gets no reply and nothing is written',
    "full control on on B: a prompt from A reaches the agent's terminal on B once and A reads a fixed word",
    'a prompt that starts with "!" is refused before anything is written',
    "a PowerShell panel and a CLI typed by hand get no ticket; an operation for one with the agent's ticket is refused",
    'control turned off on B while a prompt is held: dropped, A is told; after that A gets no reply',
    'an interrupt writes Esc and nothing else',
    "a stop ends the agent's process; a second stop is refused",
    'a start from A, same project on both: one agent panel opens on B with the stand-in CLI, its first prompt arrives once, A reads "started"',
    'that agent was started at "Ask first" although B\'s project is set to Full access',
    'another project open on B: the start is refused, no panel',
    'control switched off on B while the start waits on B\'s folder-trust question (which names A): no process starts, A reads "failed"',
    'three panels started from A are open on B, one of them without a process: the fourth start is refused',
    'B\'s workspace is full: no panel and no new workspace, A reads "failed"',
    'the remotely started panel is started again on B with Full access asked: resumed or fresh, it is "Ask first" again',
    'the live view: A\'s picture of the agent\'s panel on B is what B\'s own window reads there; a still screen sends nothing; a restart ends it ("gone"); full control off ends it ("off")',
    "another computer's agents in the thread list: A's list shows B's agent of the open project and watches nothing until it is selected; selected, its terminal box shows what B's own window reads there; the composer's Send reaches that agent once and leaves the box empty; leaving the Threads page ends the view; A's window loading again during a view ends it on B",
    "a longer command: A holds a shell request of three lines; B is shown every line (`full`, `can2`, never `can`); B's Allow once answers that request once; with the answer switch off the next one arrives without its text",
    "the git hand-over: \"Bring A's work here\" on B fetches A's commit from B's own git remote into one branch, tnai/handoff/…, and B's checked-out branch and files stay as they were; asking the other computer is not offered (its right waits for the user's yes)",
    "a picture and a text file with a prompt: A's page makes the picture small and hands both over; B saves the same bytes under names of its own, its agent is sent the words and both paths, and B's list names the files",
    'agents messaging agents: while the piece is switched off the window cannot give the right, no computer says it takes such messages, and a `say` sent anyway is dropped unread; once it can be given: the message is written with its mark and fixed line, answered `said`, and listed on B',
    "the rename limit: while A has full control on B, B's agent is renamed by `tnai rename` once and a second rename inside the minute is refused (A lists the new name); with full control off the command is as before",
    "a task that ends on B: its short result shows on A on that agent's row and the answer's text is read on demand, not from the state; B's first switch for A goes off: it is gone from A",
    "late join: B's first switch on again under the new sentence; A opens B's running agent and reads its conversation so far, newest last, shaped, cut at the pairing, marked as B's, drawn read-only (no press reaches anything), out of the pushed state; B lists one read; a new turn on B arrives by a read from where the last ended; B's switch off drops it on A",
    "late join, another project open on A: B's agent leaves A's thread list, the \"On B\" group's line says why, an ask sends nothing; the shared project again: listed again",
    "late join and the live view at once: A watches B's agent and reads its conversation as often as it may for a minute; B's trust gate never lets out 116 messages in any minute, and every answer arrived whole",
  ];
  let step = 0;
  try {
    ({ A, B, idA, idB, idX, appEnv } = await bringUp());

    // What the local relay saw: who is connected now (asked as a third computer of the account),
    // and every ticket and socket request it logged.
    const seen = async () => {
      const p = await (await relay.api('GET', '/remote/presence', relay.tokens[idX])).json(),
        log = relay.log();
      return {
        enabled: p.enabled,
        online: (p.devices || [])
          .filter(d => d.online)
          .map(d => (d.id === idA ? 'A' : d.id === idB ? 'B' : String(d.id)))
          .sort()
          .join(''),
        tickets: (log.match(/POST \/remote\/ticket/g) || []).length,
        sockets: (log.match(/GET \/remote\/connect/g) || []).length,
        logs: /GET \/remote\/presence/.test(log),
      };
    };
    const bin = a => fs.existsSync(path.join(a.profile, 'user-data', 'tnai-remote.bin'));

    // 1 ---- remote off
    step = 1;
    await sleep(3000);
    let sa = await R(A, 'state'),
      sb = await R(B, 'state'),
      r = await seen();

    // The relay writes its log a moment after it answers: the line for the question just asked is
    // read again once if it is not there yet.
    if (!r.logs) {
      await sleep(1000);
      r = await seen();
    }
    say(
      1,
      r.enabled === true &&
        r.logs &&
        sa.on === false &&
        sb.on === false &&
        sa.connection === 'off' &&
        sb.connection === 'off' &&
        r.online === '' &&
        r.tickets === 0 &&
        r.sockets === 0 &&
        !bin(A) &&
        !bin(B),
      steps[0],
      `relay: enabled ${r.enabled}, its log shows the question ${r.logs}, online "${r.online}", tickets ${r.tickets}, sockets ${r.sockets}; A: on ${sa.on}, ${sa.connection}; B: on ${sb.on}, ${sb.connection}; files: A ${bin(A)}, B ${bin(B)}`
    );

    // 2 ---- on, nothing paired: both stay connected so that another computer of the account can
    // ask to pair
    step = 2;
    sa = await R(A, 'setOn', true);
    sb = await R(B, 'setOn', true);
    try {
      await until(
        'both are online at the relay',
        async () => (await seen()).online === 'AB',
        30000
      );
    } catch {
      /* said below */
    }
    sa = await R(A, 'state');
    sb = await R(B, 'state');
    r = await seen();
    say(
      2,
      sa.on === true &&
        sb.on === true &&
        sa.self.id === idA &&
        sb.self.id === idB &&
        sa.connection === 'online' &&
        sb.connection === 'online' &&
        r.online === 'AB' &&
        r.tickets === 2 &&
        r.sockets === 2 &&
        sa.computers.length === 0 &&
        sb.computers.length === 0 &&
        !JSON.stringify([sa.computers, sb.computers]).includes('"session":true'),
      steps[1],
      `A ${sa.connection}, B ${sb.connection}; relay: online "${r.online}", tickets ${r.tickets}, sockets ${r.sockets}; paired: A ${sa.computers.length}, B ${sb.computers.length}; key files now: A ${bin(A)}, B ${bin(B)}`
    );

    // 3 ---- pairing with the two codes (never printed)
    step = 3;
    const { first, second, e1, e2, ...paired } = await pairUp(A, B);
    sa = paired.sa;
    sb = paired.sb;
    r = await seen();
    say(
      3,
      /^\d{6}$/.test(first) &&
        /^\d{6}$/.test(second) &&
        e1.ok &&
        e2.ok &&
        sa.computers.length === 1 &&
        sb.computers.length === 1 &&
        peerOf(sa, idB).online &&
        peerOf(sb, idA).online &&
        r.online === 'AB',
      steps[2],
      `A lists "${peerOf(sa, idB).name}" ${peerOf(sa, idB).state}, B lists "${peerOf(sb, idA).name}" ${peerOf(sb, idA).state}; relay: online "${r.online}", sockets ${r.sockets}`
    );

    // 4 ---- a real needs-you item on A
    step = 4;
    const pane = 'remote-check-pane',
      agent = 'Moss';
    await call(A, 'names', { list: [{ paneId: pane, name: agent, agent: 'Claude Code' }] });
    const raised = await call(A, 'raise', { paneId: pane, command: 'git push origin master' });
    const shown = await until(
      'B sees the item',
      async () => peerOf(await R(B, 'state'), idA)?.items.find(it => it.kind === 'permission'),
      15000
    );
    const gone = await call(A, 'clear', { paneId: pane });
    const cleared = await until(
      'B sees it cleared',
      async () => {
        const c = peerOf(await R(B, 'state'), idA);
        return c && c.items.length === 0 ? c : null;
      },
      15000
    );
    say(
      4,
      raised.length === 1 &&
        raised[0].kind === 'permission' &&
        shown.agent === agent &&
        gone.length === 0 &&
        cleared.session === true,
      steps[3],
      `on A: ${JSON.stringify(raised[0] || null)}; on B: ${JSON.stringify(shown)}; after clearing: ${cleared.items.length} items, ${cleared.state}`
    );

    // 5 ---- A's agents on B follow the project open on B. The agents are a
    // stand-in list (remote-two.main.js `agents`); their project keys, the sending, and what B
    // lists and counts are the app's own. One project is a git repository with a clone under
    // another folder name on B's side, one a plain folder, one each app's own seeded folder (the
    // same name in both).
    step = 5;
    const xA = path.join(base, 'shop on A'),
      xB = path.join(base, 'shop on B'),
      yA = path.join(base, 'notes');
    fs.mkdirSync(xA);
    fs.mkdirSync(yA);
    git(xA, 'init', '-q');
    fs.writeFileSync(path.join(xA, 'one.txt'), 'one\n');
    git(xA, 'add', '--', 'one.txt');
    git(xA, 'commit', '-q', '-m', 'one');
    git(base, 'clone', '-q', xA, xB);
    const seededA = await call(A, 'project');
    await call(A, 'agents', {
      list: [
        { paneId: 'pa-x', name: 'Moss', cli: 'Claude Code', project: xA },
        { paneId: 'pa-y', name: 'Wren', cli: 'Codex', project: yA },
        { paneId: 'pa-s', name: 'Kite', cli: 'Claude Code', project: seededA },
      ],
    });
    const listed = c =>
      (c?.agents || [])
        .map(a => a.id)
        .sort()
        .join();
    const aOnB = async () => peerOf(await R(B, 'state'), idA);
    const first5 = await until(
      'B lists only the agent of its open folder',
      async () => {
        const c = await aOnB();
        return c && listed(c) === 'pa-s' && c.elsewhere === 2 ? c : null;
      },
      30000
    );
    const swapAt = Date.now(),
      sw = await call(B, 'project', { dir: xB });
    const onX = await until(
      'B, with the clone open, lists the agent of that project',
      async () => {
        const c = await aOnB();
        return c && listed(c) === 'pa-x' && c.elsewhere === 2 ? c : null;
      },
      30000
    );
    const swapSecs = ((Date.now() - swapAt) / 1000).toFixed(1);
    say(
      5,
      sw?.ok === true &&
        first5.agents[0].name === 'Kite' &&
        onX.agents[0].name === 'Moss' &&
        !JSON.stringify(onX).includes('"p"'),
      steps[4],
      `B on its seeded folder: listed ${listed(first5)}, ${first5.elsewhere} in other projects; B on the clone (another folder name): listed ${listed(onX)}, ${onX.elsewhere} in other projects, ${swapSecs} s after the switch`
    );

    // 6 ---- "has this project" between two apps (6d), a new commit on A, and the first switch on A
    // taking project and keys away
    step = 6;
    await call(A, 'project', { dir: xA });
    const same = await until(
      'B says A has this project, on the same commit',
      async () => {
        const c = await aOnB();
        return c?.project?.rel === 'same' ? c : null;
      },
      30000
    );
    const commitAt = Date.now();
    fs.writeFileSync(path.join(xA, 'two.txt'), 'two\n');
    git(xA, 'add', '--', 'two.txt');
    git(xA, 'commit', '-q', '-m', 'two');
    const moved = await until(
      'B sees that A is on a commit it does not have',
      async () => {
        const c = await aOnB();
        return c?.project && c.project.rel !== 'same' && c.project.rel !== 'unknown' ? c : null;
      },
      45000
    );
    const commitSecs = ((Date.now() - commitAt) / 1000).toFixed(1);
    await R(A, 'setDetail', idB, false);
    const hidden = await until(
      'switch off on A: B is told no project and no keys, so all three are listed',
      async () => {
        const c = await aOnB();
        return c && !c.project && listed(c) === 'pa-s,pa-x,pa-y' && c.elsewhere === 0 ? c : null;
      },
      30000
    );
    await R(A, 'setDetail', idB, true);
    const again = await until(
      'switch on again: the project line and the keys are back',
      async () => {
        const c = await aOnB();
        return c && c.project && listed(c) === 'pa-x' && c.elsewhere === 2 ? c : null;
      },
      30000
    );
    say(
      6,
      same.project.rel === 'same' &&
        moved.project.rel === 'missing' &&
        hidden.agents.length === 3 &&
        !!again,
      steps[5],
      `same commit: ${same.project.rel}; ${commitSecs} s after a commit on A: ${moved.project.rel}; switch off: listed ${listed(hidden)}, project ${JSON.stringify(hidden.project)}; on again: listed ${listed(again)}, ${again.project.rel}`
    );

    // 7 ---- A quits while its item is open, then comes back
    step = 7;
    await call(A, 'raise', { paneId: pane, command: 'git push origin master' });
    await until(
      'B sees the item again',
      async () => peerOf(await R(B, 'state'), idA)?.items.length === 1,
      15000
    );
    const quitAt = Date.now(),
      how = await quitApp(A);
    const off = await until(
      'B shows A offline',
      async () => {
        const c = peerOf(await R(B, 'state'), idA);
        return c && !c.session && !c.online && c.state === 'offline' ? c : null;
      },
      45000
    );
    const offSecs = ((Date.now() - quitAt) / 1000).toFixed(1);
    const offOk = off.items.length === 0 && off.heard > 0 && off.heard <= Date.now();
    const startAt = Date.now();
    await startApp(A, appEnv);
    const authA = await call(A, 'auth');
    let back = null;
    try {
      await until(
        'the session is back',
        async () => {
          sa = await R(A, 'state');
          sb = await R(B, 'state');
          return peerOf(sa, idB)?.session && peerOf(sb, idA)?.session;
        },
        120000 - (Date.now() - A.upAt)
      );
      back = Date.now();
    } catch {
      /* reported below */
    }
    const fromUp = back ? (back - A.upAt) / 1000 : null,
      fromStart = back ? (back - startAt) / 1000 : null;
    say(
      7,
      offOk && authA.signedIn && back !== null && fromUp <= 30,
      steps[6],
      `A left by ${how}; B after ${offSecs} s: ${off.state}, items ${off.items.length}, last heard ${new Date(off.heard).toTimeString().slice(0, 8)}; session back ` +
        (back
          ? `${fromUp.toFixed(1)} s after A's window was up (${fromStart.toFixed(1)} s after it was started)`
          : 'NOT within 120 s') +
        `; items on B now ${peerOf(sb, idA)?.items.length}`
    );

    // 8 ---- remote off on B
    step = 8;
    sb = await R(B, 'setOn', false);
    let closed = true;
    try {
      await until('the relay sees B gone', async () => (await seen()).online === 'A', 20000);
    } catch {
      closed = false;
    }
    sb = await R(B, 'state');
    r = await seen();
    let aSees = 'not seen within 30 s';
    try {
      await until(
        'A shows B offline',
        async () => {
          const c = peerOf(await R(A, 'state'), idB);
          return c && !c.session;
        },
        30000
      );
      aSees = 'A shows B without a session';
    } catch {}
    say(
      8,
      closed &&
        sb.on === false &&
        sb.connection === 'off' &&
        sb.computers.length === 1 &&
        sb.computers[0].id === idA &&
        bin(B),
      steps[7],
      `relay: online "${r.online}"; B: on ${sb.on}, ${sb.connection}, pairings ${sb.computers.length}, key file ${bin(B)}; ${aSees}`
    );

    // ---- full control. See the header for what is a stand-in. A asks, B
    // is asked. ----
    step = 9;
    await R(B, 'setOn', true);
    await until(
      'the session is back after B was turned on again',
      async () => {
        sa = await R(A, 'state');
        sb = await R(B, 'state');
        return peerOf(sa, idB)?.session && peerOf(sb, idA)?.session;
      },
      60000
    );
    await call(A, 'project', { dir: xA });
    await call(B, 'project', { dir: xB }); // the same project on both (B's is the clone)
    const AGENT = 'rc-agent',
      SHELL = 'rc-shell',
      hex = s => Buffer.from(s, 'utf8').toString('hex'),
      num = () => crypto.randomBytes(8).toString('hex');
    const started = await call(B, 'standIn', { paneId: AGENT, name: 'Moss' });
    const shell = await call(B, 'shell', { paneId: SHELL });
    await call(B, 'roster', { hand: [SHELL] });
    const bOnA = async () => peerOf(await R(A, 'state'), idB),
      rowOn = (c, id) => (c?.agents || []).find(a => a.id === id);
    const opOf = async n => (await bOnA())?.ops.find(o => o.n === n) || null;
    const ended = (n, ms = 30000) =>
      until(
        'A reads how operation ' + n.slice(0, 6) + ' ended',
        async () => {
          const o = await opOf(n);
          return o && !['asked', 'queued'].includes(o.state) ? o : null;
        },
        ms
      );
    const fresh = async () => (await call(A, 'heard')).fresh || { c: 1, ms: 0 };
    const rawFromA = async msg =>
      call(A, 'raw', { to: idB, msg: { ...msg, ...(await fresh()), n: num() } });
    const repliesNow = async () => (await call(A, 'heard')).replies.length;
    const linesOnB = async () => (await R(B, 'state')).controlTotal;
    const listed9 = await until(
      "A lists B's agent and the hand-typed row",
      async () => {
        const c = await bOnA();
        return rowOn(c, AGENT) && rowOn(c, SHELL) ? c : null;
      },
      30000
    );
    let heard = await call(A, 'heard'),
      keys0 = await call(B, 'keys'),
      replies0 = heard.replies.length;
    const pressed9 = [
      (await R(A, 'prompt', idB, AGENT, 'Hello from the other computer')).sent,
      (await R(A, 'act', idB, AGENT, 'stop')).sent,
    ];
    const went9 = await rawFromA({
      t: 'prompt',
      id: AGENT,
      to: 'f'.repeat(16),
      text: 'Hello from a changed app',
    });
    await sleep(3000);
    sb = await R(B, 'state');
    say(
      9,
      started.agent === 'Claude Code' &&
        started.mode === 'run' &&
        peerOf(sb, idA).control === false &&
        listed9.canControl === false &&
        rowOn(listed9, AGENT).can === false &&
        Object.values(heard.rows).every(t => t === '') &&
        heard.control === null &&
        pressed9.every(x => x === 'not_sent') &&
        went9 === true &&
        (await repliesNow()) === replies0 &&
        (await call(B, 'keys')) === keys0 &&
        sb.controlTotal === 0,
      steps[8],
      `B's agent panel runs the stand-in (pid ${started.pid}); A: can control ${listed9.canControl}, rows ${JSON.stringify(heard.rows)}; A's own calls: ${pressed9.join(', ')}; a prompt sent anyway left A: ${went9}, replies ${(await repliesNow()) - replies0}, bytes written ${(await call(B, 'keys')).length - keys0.length}, lines on B ${sb.controlTotal}`
    );

    // 10 ---- switched on: one prompt, end to end
    step = 10;
    await R(B, 'setControl', idA, true);
    const on10 = await until(
      'A is told it may control the agent',
      async () => {
        const c = await bOnA();
        return c?.canControl && rowOn(c, AGENT)?.can ? c : null;
      },
      30000
    );

    // An interrupt while the agent is idle is refused (a guard of `tnai intervene`), and no key is
    // written. Every press hands back the row's `mark` as the page drew it;
    // without it nothing is sent.
    const markOf = async id => rowOn(await bOnA(), id)?.mark || '';
    const noMark10 = [
        (await R(A, 'prompt', idB, AGENT, 'A press without a mark')).sent,
        (await R(A, 'act', idB, AGENT, 'stop', '0'.repeat(12))).sent,
      ],
      noMarkKeys = (await call(B, 'keys')).length - keys0.length;
    const idle10 = await R(A, 'act', idB, AGENT, 'interrupt', await markOf(AGENT)),
      idleEnd = await ended(idle10.n),
      idleKeys = (await call(B, 'keys')).length - keys0.length;
    const text10 = 'Say hello from the other computer';
    const p10 = await R(A, 'prompt', idB, AGENT, text10, await markOf(AGENT)),
      end10 = await ended(p10.n);

    // What B writes is the text behind its own mark for the sender (remote-actions.js `marked`): A
    // as B names it, with the end of its id.
    const markA =
      '[Sent from ' +
      peerOf(await R(B, 'state'), idA).name.replace(/ \(…[0-9a-f]{4}\)$/, '') +
      ' (…' +
      idA.slice(-4) +
      ')] ';
    const keys10 = (await call(B, 'keys')).slice(keys0.length),
      want10 = hex('\x1b[200~' + markA + text10 + '\x1b[201~') + '0d';
    sb = await R(B, 'state');
    const line10 = sb.controlLog[0] || {},
      panel10 = await call(B, 'panel', { paneId: AGENT });
    say(
      10,
      peerOf(sb, idA).control === true &&
        peerOf(sb, idA).commands === true &&
        p10.sent === 'asked' &&
        ['sent', 'unconfirmed'].includes(end10.state) &&
        keys10 === want10 &&
        noMark10.join() === 'changed,changed' &&
        noMarkKeys === 0 &&
        /^[0-9a-f]{12}$/.test(rowOn(on10, AGENT).mark) &&
        idleEnd.state === 'refused' &&
        idleKeys === 0 &&
        sb.controlTotal === 2 &&
        sb.controlLog[1].op === 'interrupt' &&
        line10.op === 'prompt' &&
        line10.agent === 'Moss' &&
        line10.head === text10,
      steps[9],
      `A: sent "${p10.sent}", then "${end10.state}"; the stand-in got ${keys10 === want10 ? 'exactly one paste of "' + markA + '" and the text, and one Enter' : 'OTHER BYTES: ' + keys10.slice(0, 160)}; B's list: ${JSON.stringify({ op: line10.op, agent: line10.agent, from: line10.name, length: line10.length })}; the agent is ${panel10.busy ? 'working' : 'idle'}; can start: ${JSON.stringify(on10.canStart)}; an interrupt before it, with the agent idle: "${idleEnd.state}", bytes ${idleKeys}; a prompt and a stop pressed without the row's mark: ${noMark10.join(', ')}, bytes ${noMarkKeys}`
    );

    // 11 ---- a first "!" (a CLI's shell mode): A's own check, and B's when a changed A sends it
    step = 11;
    heard = await call(A, 'heard');
    const ticket = heard.known[AGENT] || '';
    const keys11 = await call(B, 'keys'),
      lines11 = await linesOnB(),
      replies11 = heard.replies.length;
    const own11 = [
      (await R(A, 'prompt', idB, AGENT, '!whoami')).sent,
      (await R(A, 'prompt', idB, AGENT, '/clear')).sent,
      (await R(A, 'prompt', idB, AGENT, '  !dir')).sent,
    ];
    await rawFromA({ t: 'prompt', id: AGENT, to: ticket, text: '!whoami' });
    const reply11 = await until(
      'B answers the "!" prompt',
      async () => (await call(A, 'heard')).replies[replies11],
      15000
    );
    say(
      11,
      /^[0-9a-f]{16}$/.test(ticket) &&
        own11.every(x => x === 'no_word') &&
        reply11.t === 'prompted' &&
        reply11.ok === false &&
        reply11.word === 'refused' &&
        (await call(B, 'keys')) === keys11 &&
        (await linesOnB()) === lines11,
      steps[10],
      `A's own check: ${own11.join(', ')}; sent anyway with the agent's real ticket: B answered "${reply11.word}", bytes written ${(await call(B, 'keys')).length - keys11.length}, new lines on B ${(await linesOnB()) - lines11}`
    );

    // 12 ---- a PowerShell panel, and a CLI typed by hand into one
    step = 12;
    const c12 = await bOnA(),
      replies12 = await repliesNow(),
      lines12 = await linesOnB();
    await rawFromA({ t: 'prompt', id: SHELL, to: ticket, text: 'dir' });
    const reply12 = await until(
      'B answers the prompt for the PowerShell panel',
      async () => (await call(A, 'heard')).replies[replies12],
      15000
    );
    const shell12 = await call(B, 'panel', { paneId: SHELL }),
      own12 = (await R(A, 'prompt', idB, SHELL, 'dir')).sent;
    say(
      12,
      heard.rows[SHELL] === '' &&
        heard.rows[AGENT] === ticket &&
        rowOn(c12, SHELL)?.can === false &&
        rowOn(c12, AGENT)?.can === true &&
        own12 === 'not_sent' &&
        reply12.ok === false &&
        reply12.word === 'refused' &&
        shell12.running &&
        shell12.alive &&
        (await linesOnB()) === lines12,
      steps[11],
      `rows as A got them: agent ${heard.rows[AGENT] ? 'with a ticket' : 'NO TICKET'}, PowerShell panel with a typed CLI ${heard.rows[SHELL] === '' ? 'without one' : 'WITH A TICKET'}; A's own call: ${own12}; a prompt for it with the agent's ticket: "${reply12.word}"; the PowerShell (pid ${shell.pid}) still runs: ${shell12.alive}`
    );

    // 13 ---- a prompt held on B (its agent works), then the switch goes off
    step = 13;
    const keys13 = await call(B, 'keys');
    const p13 = await R(
      A,
      'prompt',
      idB,
      AGENT,
      'A second prompt while it works',
      await markOf(AGENT)
    );
    const queued13 = await until(
      'A reads that B holds the prompt',
      async () => {
        const o = await opOf(p13.n);
        return o?.state === 'queued' ? o : null;
      },
      20000
    );
    const held13 = await call(B, 'held');
    await R(B, 'setControl', idA, false);
    const heldAfter = await call(B, 'held'),
      end13 = await ended(p13.n, 15000);
    const off13 = await until(
      'A is told there is nothing to control',
      async () => {
        const c = await bOnA();
        return c && !c.canControl ? c : null;
      },
      15000
    );
    const replies13 = await repliesNow(),
      lines13 = await linesOnB();
    const went13 = await rawFromA({
      t: 'prompt',
      id: AGENT,
      to: ticket,
      text: 'With the old ticket, the switch off',
    });
    await sleep(3000);
    say(
      13,
      queued13.state === 'queued' &&
        held13.length === 1 &&
        held13[0].paneId === AGENT &&
        heldAfter.length === 0 &&
        end13.state === 'failed' &&
        rowOn(off13, AGENT)?.can === false &&
        went13 === true &&
        (await repliesNow()) === replies13 &&
        (await linesOnB()) === lines13 &&
        (await call(B, 'keys')) === keys13,
      steps[12],
      `held on B: ${JSON.stringify(held13)}; after the switch went off: held ${heldAfter.length}, A reads "${end13.state}"; then a prompt with the old ticket left A: ${went13}, replies ${(await repliesNow()) - replies13}, new lines ${(await linesOnB()) - lines13}; bytes written in all of this: ${(await call(B, 'keys')).length - keys13.length}`
    );

    // 14 ---- interrupt: Esc only. (B answers 4 interrupts or stops a minute from one computer and
    // nothing past that; this check sends exactly four: the idle one in 10, this one, and the two
    // stops of 15.)
    step = 14;
    await R(B, 'setControl', idA, true);
    await until(
      'A may control the agent again',
      async () => rowOn(await bOnA(), AGENT)?.can === true,
      30000
    );
    const keys14 = await call(B, 'keys'),
      busy14 = (await call(B, 'panel', { paneId: AGENT })).busy;
    const i14 = await R(A, 'act', idB, AGENT, 'interrupt', await markOf(AGENT)),
      end14 = await ended(i14.n);
    const got14 = (await call(B, 'keys')).slice(keys14.length),
      after14 = await call(B, 'panel', { paneId: AGENT });
    say(
      14,
      busy14 === true &&
        i14.sent === 'asked' &&
        ['done', 'unsent'].includes(end14.state) &&
        got14 === '1b' &&
        after14.running,
      steps[13],
      `the agent was working: ${busy14}; A reads "${end14.state}"; the stand-in got ${got14 === '1b' ? 'one Esc and nothing else' : 'OTHER BYTES: ' + got14}; B marks the panel: ${JSON.stringify(after14.items)}`
    );

    // 15 ---- stop
    step = 15;
    const s15 = await R(A, 'act', idB, AGENT, 'stop', await markOf(AGENT)),
      end15 = await ended(s15.n);
    let gone15 = true;
    try {
      await until(
        "the stand-in's process is gone",
        async () => !(await call(B, 'alive', { pid: started.pid })),
        15000
      );
    } catch {
      gone15 = false;
    }
    const panel15 = await call(B, 'panel', { paneId: AGENT }),
      replies15 = await repliesNow();
    await rawFromA({ t: 'act', id: AGENT, to: ticket, do: 'stop' });
    const reply15 = await until(
      'B answers the second stop',
      async () => (await call(A, 'heard')).replies[replies15],
      15000
    );
    const shell15 = await call(B, 'panel', { paneId: SHELL });
    say(
      15,
      end15.state === 'done' &&
        gone15 &&
        !panel15.running &&
        reply15.t === 'acted' &&
        reply15.ok === false &&
        ['refused', 'failed'].includes(reply15.word) &&
        shell15.alive,
      steps[14],
      `A reads "${end15.state}"; the stand-in (pid ${started.pid}) is gone: ${gone15}; a second stop with its old ticket: "${reply15.word}"; the PowerShell panel still runs: ${shell15.alive}`
    );

    // ---- a start from A: six starts in all, which is what B
    // takes from one computer in 10 minutes, and 3 a minute, so the later ones wait for the earlier
    // ones to age out. Every start is A's own `remote.start` call. ----
    step = 16;
    const zB = path.join(base, 'another project');
    fs.mkdirSync(zB);
    git(zB, 'init', '-q');
    fs.writeFileSync(path.join(zB, 'z.txt'), 'z\n');
    git(zB, 'add', '--', 'z.txt');
    git(zB, 'commit', '-q', '-m', 'z');
    const found = await call(B, 'detect'),
      // B's own check of its CLIs, and this project set to Full access on B
      level = await call(B, 'access', { level: 'full' });
    info(
      'B finds these CLIs: ' +
        found.join(', ') +
        '; its level for this project is now "' +
        level +
        '"'
    );
    try {
      await until(
        'A is told an agent can be started on B',
        async () => (await bOnA())?.canStart.includes('claude'),
        30000
      );
    } catch (e) {
      const c = await bOnA();
      throw new Error(
        e.message +
          ' (A has: can control ' +
          c?.canControl +
          ', can start ' +
          JSON.stringify(c?.canStart) +
          ', session ' +
          c?.session +
          ')'
      );
    }
    const sentAt = [];
    const pace = async () => {
      const third = sentAt.at(-3),
        left = third ? 61500 - (Date.now() - third) : 0;
      if (left > 0) {
        info(
          'waiting ' + Math.ceil(left / 1000) + ' s: B takes 3 starts a minute from one computer'
        );
        await sleep(left);
      }
      sentAt.push(Date.now());
    };
    const startFromA = async text => {
      await pace();
      return R(A, 'start', idB, 'claude', text);
    };
    const panelsOn = () => call(B, 'panels'),
      fresh16 = (before, after) =>
        after.list.filter(p => !before.list.some(q => q.paneId === p.paneId));
    const keysOf = paneId => call(B, 'keys', { paneId }),
      pasteOf = text => hex('\x1b[200~' + markA + text + '\x1b[201~');
    const before16 = await panelsOn(),
      text16 = 'Write the tests for the start';
    const s16 = await startFromA(text16);

    // the folder was never allowed for this CLI on B: B asks its own user, and only B answers
    // (here: yes, as its user would)
    let trust16 = 0;
    const end16 = await until(
      'A reads how the start ended',
      async () => {
        trust16 += await call(B, 'trust', { yes: true });
        const o = await opOf(s16.n);
        return o && o.state !== 'asked' ? o : null;
      },
      150000,
      400
    );
    const after16 = await panelsOn(),
      new16 = fresh16(before16, after16),
      p16 = new16[0] || {};
    let got16 = '';
    try {
      got16 = await until(
        'the new agent got its first prompt',
        async () => {
          const k = await keysOf(p16.paneId);
          return k.includes(pasteOf(text16) + '0d') ? k : null;
        },
        15000
      );
    } catch {
      got16 = p16.paneId ? await keysOf(p16.paneId) : '';
    }
    const once16 = got16.split(pasteOf(text16)).length - 1;
    sb = await R(B, 'state');
    const line16 = sb.controlLog.find(l => l.op === 'start') || {};
    const offered16 = (await bOnA()).canStart;
    say(
      16,
      found.includes('Claude Code') &&
        !offered16.includes('codex') &&
        !offered16.includes('cursor') &&
        s16.sent === 'asked' &&
        end16.state === 'started' &&
        new16.length === 1 &&
        p16.agent === 'Claude Code' &&
        p16.mode === 'run' &&
        p16.running &&
        !!p16.standIn &&
        p16.remote === true &&
        after16.remote === before16.remote + 1 &&
        once16 === 1 &&
        line16.agent === 'Claude Code' &&
        line16.head === text16,
      steps[15],
      `A reads "${end16.state}"; new panels on B: ${new16.length} (${p16.agent}, ${p16.standIn ? 'the stand-in, pid ' + p16.standIn.pid : 'NOT the stand-in'}, counted as started from another computer: ${p16.remote}); "Trust this folder?" was asked on B and answered there: ${trust16}; its first prompt arrived ${once16} time(s); B offers A to start: ${JSON.stringify(offered16)} (never Codex or Cursor Agent, whatever is installed there); B's list: ${JSON.stringify({ op: line16.op, agent: line16.agent, length: line16.length })}`
    );

    // 17 ---- the same start: its access level (review test 18)
    step = 17;
    say(
      17,
      level === 'full' && p16.standIn?.mode === 'manual',
      steps[16],
      `B's level for this project (the composer's Access menu): "${level}"; the stand-in was started with --permission-mode ${p16.standIn?.mode} (Claude Code's flag for "Ask first" is "manual"; Full access would be "bypassPermissions")`
    );

    // 18 ---- another project open on B
    step = 18;
    await call(B, 'project', { dir: zB });
    await sleep(1500);
    const before18 = await panelsOn(),
      s18 = await startFromA(''),
      end18 = await ended(s18.n, 30000),
      after18 = await panelsOn();
    await call(B, 'project', { dir: xB });
    await sleep(1500);
    say(
      18,
      s18.sent === 'asked' &&
        end18.state === 'refused' &&
        fresh16(before18, after18).length === 0 &&
        after18.remote === before18.remote,
      steps[17],
      `B has another git project open (its own first commit); A asks for its project: A reads "${end18.state}"; new panels ${fresh16(before18, after18).length}, counted ${after18.remote}`
    );

    // 19 ---- the switch goes off while the start waits. B
    // opens another copy of the same project, which that CLI was never allowed in, so the start
    // waits on B's own "Trust this folder?" question. B's user turns control off and only then says
    // yes: no process may start at all.
    step = 19;
    const xB2 = path.join(base, 'shop on B again');
    git(base, 'clone', '-q', xA, xB2);
    await call(B, 'project', { dir: xB2 });
    await sleep(1500);
    const before19 = await panelsOn(),
      text19 = 'This text must never arrive',
      keys19a = await call(B, 'keys');
    const s19 = await startFromA(text19);
    const ask19 = await until(
      'B asks its own user to trust the folder for the new agent',
      async () => (await call(B, 'trustOpen'))[0],
      30000,
      300
    );
    await R(B, 'setControl', idA, false);
    const answered19 = await call(B, 'trust', { yes: true });
    const end19 = await ended(s19.n, 60000);
    await sleep(1500);
    const after19 = await panelsOn(),
      new19 = fresh16(before19, after19),
      keys19 = (await call(B, 'keys')).slice(keys19a.length),
      counted19 = await call(B, 'wasRemote', { paneId: ask19.paneId });
    const open19 = { paneId: ask19.paneId };
    await call(B, 'project', { dir: xB });
    await sleep(1500);
    await R(B, 'setControl', idA, true);
    await until(
      'A may start an agent on B again',
      async () => (await bOnA())?.canStart.includes('claude'),
      30000
    );
    say(
      19,
      end19.state === 'failed' &&
        answered19 === 1 &&
        new19.length === 0 &&
        !keys19.includes(hex(text19)) &&
        counted19 === true &&
        after19.remote === before19.remote + 1 &&
        /An agent started from .+\(….{4}\)/.test(ask19.body) &&
        !/The agent you started/.test(ask19.body),
      steps[18],
      `B asked: "${String(ask19.title).slice(0, 60)}" / "…${(/[^.]*needs it\./.exec(ask19.body) || [''])[0].trim()}"; control went off, then its user said yes; A reads "${end19.state}"; processes started for it: ${new19.length}; its first prompt arrived: ${keys19.includes(hex(text19))}; the panel is still counted as started from another computer: ${counted19}`
    );

    // 20 ---- three such panels are open (one of them never got its process): the fourth is refused
    step = 20;
    const s20 = await startFromA(''),
      end20 = await ended(s20.n, 150000),
      mid20 = await panelsOn();
    const s20b = await startFromA(''),
      end20b = await ended(s20b.n, 30000),
      after20 = await panelsOn();
    say(
      20,
      end20.state === 'started' &&
        mid20.remote === 3 &&
        mid20.list.filter(p => p.remote && p.running).length === 2 &&
        end20b.state === 'refused' &&
        after20.remote === 3 &&
        fresh16(mid20, after20).length === 0,
      steps[19],
      `a third start: "${end20.state}"; counted on B: ${mid20.remote} (running ${mid20.list.filter(p => p.remote && p.running).length}, without a process ${mid20.remote - mid20.list.filter(p => p.remote && p.running).length}); the fourth: A reads "${end20b.state}", new panels ${fresh16(mid20, after20).length}`
    );

    // 21 ---- the workspace is full: no panel, and no new workspace as a start made on B itself
    // would get
    step = 21;

    // B's user closes the stopped one: two are counted, so the limit of three is not what refuses
    await call(B, 'close', { paneId: open19.paneId });
    const two21 = (await panelsOn()).remote;
    await pace();
    const ws0 = await call(B, 'workspace', { fill: true }),
      before21 = await panelsOn();
    const s21 = await R(A, 'start', idB, 'claude', ''),
      end21 = await ended(s21.n, 60000);
    const ws1 = await call(B, 'workspace'),
      after21 = await panelsOn();
    say(
      21,
      two21 === 2 &&
        ws0.count === ws0.max &&
        ws0.wouldOverflow === true &&
        s21.sent === 'asked' &&
        end21.state === 'failed' &&
        ws1.panes === ws0.panes &&
        ws1.workspaces === ws0.workspaces &&
        after21.remote === 2 &&
        fresh16(before21, after21).length === 0,
      steps[20],
      `counted before: ${two21}; B's workspace: ${ws0.count} of ${ws0.max} panels, a start made on B itself would open another workspace: ${ws0.wouldOverflow}; A reads "${end21.state}"; panels ${ws0.panes} → ${ws1.panes}, workspaces ${ws0.workspaces} → ${ws1.workspaces}, new agent panels ${fresh16(before21, after21).length}, counted ${after21.remote}`
    );

    // 22 ---- "Ask first" holds for every later start of that panel,
    // not only its first process. The panel of proof 16 is stopped and started again by B's own
    // window call, as when its user presses Enter in it or the app offers to resume it; the start
    // asks for Full access, as B's project level would give.
    step = 22;
    const resumed22 = await call(B, 'restart', {
      paneId: p16.paneId,
      access: 'full',
      resumeId: '11111111-2222-3333-4444-555555555555',
    });
    const fresh22 = await call(B, 'restart', { paneId: p16.paneId, access: 'full' }),
      counted22 = await call(B, 'wasRemote', { paneId: p16.paneId });

    // Changed 2026-10-10 ("Added 2026-10-10"): a resumed Claude Code
    // conversation of such a panel is no longer refused; it is resumed and held, the flag going on
    // the resume itself.
    say(
      22,
      resumed22.ok === true &&
        resumed22.running === true &&
        resumed22.mode === 'manual' &&
        fresh22.ok === true &&
        fresh22.mode === 'manual' &&
        counted22 === true,
      steps[21],
      `resumed, Full access asked: ${resumed22.ok ? 'started with --permission-mode ' + resumed22.mode : 'NOT started ("' + String(resumed22.error).slice(0, 90) + '…")'}; fresh, Full access asked: started with --permission-mode ${fresh22.mode}; still counted as started from another computer: ${counted22}`
    );

    // 23 ---- the live view: A watches the agent of proof 16 on B.
    // What is on that screen is whatever the stand-in printed; the comparison is with what B's own
    // window reads from the same terminal at that moment. Full control goes off at its end: the
    // last proof needs only the first switch.
    step = 23;

    // B takes four views a minute from one computer: proof 24 asks for its last one after this
    // minute
    const began23 = Date.now();
    const lines23 = m => (m?.picture?.lines || []).map(l => String(l.t).trimEnd());
    const ended23 = label =>
      until(
        label,
        async () => {
          const x = await R(A, 'viewNow');
          return x && x.state === 'ended' ? x : null;
        },
        30000
      ).catch(() => null);

    // The row A holds for that agent must be the one of the process that runs now: after a restart
    // on B the new row arrives up to three seconds later (one agent list per computer in that
    // time), and B refuses a view asked with the ticket of the process before.
    const settled23 = async () => {
      const t0 = Date.now();
      let last = null,
        since = Date.now();
      for (;;) {
        const m = await markOf(p16.paneId);
        if (m !== last) {
          last = m;
          since = Date.now();
        }
        if ((m && Date.now() - since >= 4000) || Date.now() - t0 > 30000) return m;
        await sleep(300);
      }
    };
    const watch23 = async () => {
      await until(
        'A may watch that agent',
        async () => {
          const c = await bOnA();
          return c?.canWatch && rowOn(c, p16.paneId)?.can ? c : null;
        },
        30000
      );
      await settled23();
      const r = await R(A, 'view', idB, p16.paneId, await markOf(p16.paneId));
      const m = await until(
        'A has the picture',
        async () => {
          const x = await R(A, 'viewNow');
          return x && (x.state === 'ended' || (x.state === 'on' && x.picture)) ? x : null;
        },
        30000
      ).catch(() => null);
      return { sent: r?.sent, m };
    };
    const v23 = await watch23(),
      own23 = await call(B, 'screenText', { paneId: p16.paneId }),
      sb23 = await R(B, 'state');
    const same23 =
      !!v23.m?.picture &&
      Array.isArray(own23) &&
      lines23(v23.m).join('\n').trimEnd() === own23.join('\n').trimEnd() &&
      own23.some(l => l.trim() !== '');
    const mark23 = (sb23.watching || []).some(x => x.peer === idA && x.panelId === p16.paneId),
      line23 = (sb23.controlLog || []).some(e => e.op === 'watch');
    const inState23 = JSON.stringify(await R(A, 'state')).includes('"picture"');
    const at23 = v23.m?.picture?.at;
    await sleep(10000);

    // a still screen: no new picture in ten seconds
    const still23 = at23 !== undefined && (await R(A, 'viewNow'))?.picture?.at === at23;

    // the agent is restarted during the view
    await call(B, 'restart', { paneId: p16.paneId, access: 'full' });
    const gone23 = await ended23('A reads that the agent changed');
    await R(A, 'unview', 'closed');
    const v23b = await watch23().catch(() => ({ m: null }));
    await R(B, 'setControl', idA, false); // the right ends while the view runs
    const off23 = await ended23('A reads that the right ended'),
      after23 = await R(B, 'state');
    await R(A, 'unview', 'closed');
    say(
      23,
      v23.sent === 'asked' &&
        v23.m?.state === 'on' &&
        same23 &&
        mark23 &&
        line23 &&
        !inState23 &&
        still23 &&
        gone23?.why === 'gone' &&
        v23b.m?.state === 'on' &&
        off23?.why === 'off' &&
        off23.picture === null &&
        (after23.watching || []).length === 0,
      steps[22],
      `A asked: "${v23.sent}", then "${v23.m?.state}"; A's picture equals B's own reading of that panel: ${same23} (${Array.isArray(own23) ? own23.filter(l => l.trim()).length : 0} rows with text); on B the state names the watcher: ${mark23}, the list has its line: ${line23}; a picture in A's pushed state: ${inState23}; no new picture in 10 still seconds: ${still23}; the agent restarted: "${gone23?.why}"; watched again: "${v23b.m?.state}"; full control off: "${off23?.why}", picture dropped: ${off23 ? off23.picture === null : '?'}; views left on B: ${(after23.watching || []).length}`
    );

    // 24 ---- another computer's agents in the thread list, in
    // A's own window: B's agent of the open project is listed under B's name; listing it watches
    // nothing; selecting it shows its terminal panel live in the thread's main area (compared with
    // B's own reading of that panel at that moment); the composer's Send reaches that agent as a
    // prompt; leaving the Threads page ends the view on both. No message of its own: view, prompt
    // and unview, as in the proofs before. Full control goes on for it and off at its end, as proof
    // 23 left it: the last proof needs only the first switch.
    step = 24;
    const key24 = idB + '\n' + p16.paneId,
      far24 = (what = 'read', text = '') => call(A, 'farAgents', { what, key: key24, text });
    const watchers24 = async () =>
      ((await R(B, 'state')).watching || []).filter(x => x.peer === idA).length;
    await R(B, 'setControl', idA, true);
    await until(
      'A may watch that agent again',
      async () => {
        const c = await bOnA(),
          r = rowOn(c, p16.paneId);
        return c?.canWatch && r?.can && r.sure ? c : null;
      },
      30000
    );
    await call(A, 'page', { view: 'threads' });
    const list24 = await until(
      "A's thread list shows B's agent",
      async () => {
        const p = await far24();
        return p?.onPage && p.rows.some(r => r.key === key24) ? p : null;
      },
      15000
    ).catch(() => null);
    const sure24 = ((await bOnA())?.agents || []).filter(a => a.sure).length;
    await sleep(1500);
    const idle24 = await watchers24(),
      unasked24 = await R(A, 'viewNow'); // listed, nothing selected: nothing is watched

    // not inside the page's quiet time; the view is asked about a second later
    await until('the row takes the click', () => far24('select'), 8000, 400);
    const on24 = await until(
      'the page shows the picture',
      async () => {
        const p = await far24();
        return p?.detail &&
          (p.detail.view === 'ended' ||
            (p.detail.view === 'on' && p.detail.lines.some(l => l.trim())))
          ? p
          : null;
      },
      30000
    ).catch(() => null);
    const own24 = await call(B, 'screenText', { paneId: p16.paneId }),
      now24 = await far24();
    const same24 =
      Array.isArray(own24) &&
      !!now24?.detail &&
      now24.detail.view === 'on' &&
      now24.detail.lines.join('\n').trimEnd() === own24.join('\n').trimEnd() &&
      own24.some(l => l.trim() !== '');
    const mark24 = ((await R(B, 'state')).watching || []).some(
      x => x.peer === idA && x.panelId === p16.paneId
    );
    const text24 = 'Say what the page shows',
      keys24 = await keysOf(p16.paneId);
    const pressed24 = await until(
      'the target button takes a press',
      () => far24('press', 'Send composer tasks here'),
      8000,
      400
    ).catch(() => false);
    await sleep(900);
    const aimed24 = await far24();
    await far24('send', text24);
    await sleep(700);

    // With no hint on screen (a narrow composer) the first Enter only says where the prompt would
    // go; the next one sends it.
    const asked24 =
      (await far24())?.draft === text24 &&
      !(await keysOf(p16.paneId)).slice(keys24.length).includes(pasteOf(text24));
    if (asked24) await far24('enter');
    const arrived24 = async ms => {
      try {
        return !!(await until(
          "B's agent got the composer's prompt",
          async () =>
            (await keysOf(p16.paneId)).slice(keys24.length).includes(pasteOf(text24) + '0d'),
          ms
        ));
      } catch {
        return false;
      }
    };
    const op24 = async () =>
      ((await bOnA())?.ops || []).find(o => o.kind === 'prompt' && o.id === p16.paneId) || null;
    let got24 = await arrived24(8000),
      how24 = got24 ? 'at once' : '',
      held24 = [];
    if (!got24) {
      // Not written yet. A prompt for an agent that is in a turn is taken and held on B until the
      // agent is free (6f), and A's row says so: that is not a lost prompt. The stand-in never ends
      // a turn by itself, so the turn is ended here as the CLI's own hook would.
      const o = await op24();
      held24 = await call(B, 'held').catch(() => []);
      how24 = 'A reads "' + (o ? o.state : 'no word') + '"; held on B: ' + JSON.stringify(held24);
      if (o && o.state === 'queued') {
        await call(B, 'finish', {
          paneId: p16.paneId,
          task: 'An earlier task',
          answer: 'Done with the earlier task.',
        });
        got24 = await arrived24(30000);
        how24 += got24
          ? "; written once the agent's turn ended"
          : '; NOT written after the turn ended';
      }
    }
    const sent24 = await far24(),
      once24 = (await keysOf(p16.paneId)).slice(keys24.length).split(pasteOf(text24)).length - 1;
    await call(A, 'page', { view: 'devices' }); // the Threads page is left while the view runs
    let left24 = false;
    try {
      left24 = !!(await until(
        'the view ended on B',
        async () => (await watchers24()) === 0,
        30000
      ));
    } catch {
      /* said below */
    }
    const viewA24 = await R(A, 'viewNow');
    await R(B, 'setControl', idA, false);
    let gone24a = false;
    try {
      gone24a = !!(await until(
        "A's composer lets the agent go",
        async () => {
          const p = await far24();
          return p && p.hint === '' ? p : null;
        },
        30000
      ));
    } catch {
      /* said below */
    }

    // A's window loads again while a view runs: B is no
    // longer watched. The view is started from the page once more (full control on again; the row
    // is selected again if the page let it go, else Watch again is pressed).
    await R(B, 'setControl', idA, true);
    await until(
      'A may watch that agent once more',
      async () => {
        const c = await bOnA(),
          r = rowOn(c, p16.paneId);
        return c?.canWatch && r?.can && r.sure ? c : null;
      },
      30000
    );
    {
      const left = 62000 - (Date.now() - began23);
      if (left > 0) {
        info(
          'waiting ' + Math.ceil(left / 1000) + ' s: B takes 4 views a minute from one computer'
        );
        await sleep(left);
      }
    }
    await call(A, 'page', { view: 'threads' });
    const again24 = await until(
      'the view runs again',
      async () => {
        const p = await far24();
        if (p?.detail?.view === 'on') return p;
        if (p?.detail?.view !== 'asked' && p?.detail?.view !== 'soon') {
          if (!(await far24('press', 'Watch again'))) await far24('select');
        }
        return null;
      },
      40000,
      1500
    ).catch(() => null);
    const watched24 = await watchers24();
    await call(A, 'reload');
    let reload24 = false;
    try {
      reload24 = !!(await until(
        "B is no longer watched after A's window loaded again",
        async () => (await watchers24()) === 0,
        30000
      ));
    } catch {
      /* said below */
    }
    const viewR24 = await R(A, 'viewNow');
    await R(B, 'setControl', idA, false);
    say(
      24,
      !!list24 &&
        list24.groups.length === 1 &&
        list24.groups[0].computer === idB &&
        list24.rows.length === sure24 &&
        list24.rows.every(r => !r.selected) &&
        !list24.detail &&
        idle24 === 0 &&
        (!unasked24 || unasked24.state === 'ended') &&
        on24?.detail?.view === 'on' &&
        same24 &&
        mark24 &&
        pressed24 === true &&
        /^On .+ → /.test(aimed24?.hint || '') &&
        got24 &&
        once24 === 1 &&
        sent24?.draft === '' &&
        left24 &&
        (!viewA24 || viewA24.state === 'ended') &&
        gone24a &&
        again24?.detail?.view === 'on' &&
        watched24 === 1 &&
        reload24 &&
        (!viewR24 || viewR24.state === 'ended'),
      steps[23],
      list24
        ? `A's page: group "${list24.groups.map(g => g.name).join('", "')}" with ${list24.rows.length} row(s) of ${sure24} known to be in this project; watched before a row was selected: ${idle24} on B, a view on A: ${unasked24 ? unasked24.state : 'none'}; selected: "${on24?.detail?.name}" (${on24?.detail?.sub}), terminal box "${now24?.detail?.view}"${now24?.detail?.note ? ' ("' + now24.detail.note + '")' : ''}; its rows equal B's own reading of that panel: ${same24} (${Array.isArray(own24) ? own24.filter(l => l.trim()).length : 0} rows with text); B names the watcher: ${mark24}; target pressed: ${pressed24}, hint "${aimed24?.hint}"; the first Enter only asked: ${asked24}; the composer's prompt arrived on B: ${got24} (${how24}), ${once24} time(s), draft left: "${sent24?.draft}"; page left: views on B ${left24 ? 0 : 'still there'}, A's view "${viewA24 ? viewA24.state : 'none'}"; full control off: the composer's hint is gone: ${gone24a}; watched from the page again: "${again24?.detail?.view}", views on B ${watched24}; A's window loaded again: views on B ${reload24 ? 0 : 'still there'}, A's view "${viewR24 ? viewR24.state : 'none'}"`
        : "A's thread list never showed B's agent within 15 s"
    );

    // 25 ---- a longer command answered from the other computer (changes 7 and 8).
    // A holds the request (a Claude Code-shaped permission request
    // posted to A's own hook server, as in proof 4), B answers. Nothing here needs full control:
    // only A's "may answer" switch for B, which goes off again at the end.
    step = 25;
    const long25 = 'npm run build &&\n  npm test -- --watch=false\necho done',
      pane25 = 'pane-long-25'; // aOnB (A as B lists it) is the helper of the first proofs
    await R(A, 'setDetail', idB, true);
    await R(A, 'setAnswer', idB, true);
    await call(A, 'raise', { paneId: pane25, command: long25 });
    const it25 = await until(
      'B is shown the whole command',
      async () => {
        const c = await aOnB();
        return (c?.items || []).find(i => i.can2 === true && i.full === long25) || null;
      },
      30000
    ).catch(() => null);
    const before25 = ((await R(A, 'state')).answers || []).length;
    const sent25 = it25 ? (await R(B, 'answer', idA, it25.id, 'yes', it25.of)).sent : 'no item';
    let taken25 = false;
    try {
      taken25 = !!(await until(
        "A's request is answered",
        async () => {
          const c = await aOnB();
          return !!it25 && !(c?.items || []).some(i => i.id === it25.id);
        },
        30000
      ));
    } catch {
      /* said below */
    }
    const again25 = it25 ? (await R(B, 'answer', idA, it25.id, 'yes', it25.of)).sent : 'no item';
    await sleep(1500);
    const sa25 = await R(A, 'state'),
      notes25 = (sa25.answers || []).length - before25,
      note25 = (sa25.answers || [])[0];
    await R(A, 'setAnswer', idB, false);
    await call(A, 'raise', { paneId: pane25 + 'b', command: long25 + '\necho again' });
    const off25 = await until(
      'B lists the second request',
      async () => {
        const c = await aOnB();
        return (
          (c?.items || []).find(
            i =>
              i.kind === 'permission' &&
              i.id !== it25?.id &&
              /^Bash: npm run build/.test(i.detail || '')
          ) || null
        );
      },
      30000
    ).catch(() => null);
    await call(A, 'clear', { paneId: pane25 + 'b' });
    await call(A, 'clear', { paneId: pane25 });
    say(
      25,
      !!it25 &&
        it25.can === undefined &&
        typeof it25.of === 'string' &&
        sent25 === 'sent' &&
        taken25 &&
        notes25 === 1 &&
        note25?.say === 'yes' &&
        again25 !== 'sent' &&
        !!off25 &&
        off25.full === undefined &&
        off25.can2 === undefined &&
        off25.can === undefined,
      steps[24],
      it25
        ? `B's item: ${it25.full.split('\n').length} lines as \`full\`, can2 ${it25.can2}, can ${it25.can}; B's Allow once: "${sent25}"; the request left B's list: ${taken25}; answers A counted: ${notes25} ("${note25?.say}"); a second press: "${again25}"; with the answer switch off the next one has full: ${off25 ? off25.full !== undefined : '?'}, can2: ${off25 ? off25.can2 === true : '?'}`
        : 'B was never shown the whole command within 30 s'
    );

    // 26 ---- the git hand-over: "Bring A's work here" pressed
    // on B. B's copy is a clone of A's folder, so A's folder is B's own git remote: real git, a
    // real fetch by the commit's id, a real branch; nothing of it is a stand-in. Both apps have had
    // the same project open since step
    // 9. The other direction ("Hand my commits to") must not be offered: its right waits for the
    // user's yes to a sentence.
    step = 26;
    fs.writeFileSync(path.join(xA, 'handed.txt'), 'handed\n');
    git(xA, 'add', '--', 'handed.txt');
    git(xA, 'commit', '-q', '-m', 'handed');
    fs.writeFileSync(path.join(xB, 'not-committed.txt'), 'work in progress on B\n');
    const headA26 = git(xA, 'rev-parse', 'HEAD'),
      headB26 = git(xB, 'rev-parse', 'HEAD'),
      onB26 = git(xB, 'symbolic-ref', 'HEAD'),
      statusB26 = git(xB, 'status', '--porcelain=v1');
    let offered26 = null;
    try {
      offered26 = await until(
        "B can bring A's newest commit",
        async () => {
          const c = await aOnB();
          return c?.bringable &&
            c.project &&
            c.project.rel !== 'same' &&
            c.project.rel !== 'unknown'
            ? c
            : null;
        },
        45000
      );
      await sleep(4000); /* A tells its new commit at most every 3 s */
    } catch {
      /* said below */
    }
    const press26 = offered26 ? await R(B, 'bring', idA).catch(() => null) : null;
    let done26 = null;
    try {
      done26 = await until(
        'B says how it ended',
        async () => {
          const c = await aOnB();
          return c?.brought && c.brought.state !== 'going' ? c : null;
        },
        60000
      );
    } catch {
      /* said below */
    }
    let named26 = null;
    try {
      named26 = await until(
        "B's card names the branch",
        async () => {
          const c = await aOnB();
          return c?.handed ? c : null;
        },
        30000
      );
    } catch {
      /* said below */
    }
    const branch26 = named26?.handed || '',
      tip26 = /^tnai\/handoff\/[a-z0-9]{8,12}$/.test(branch26)
        ? git(xB, 'rev-parse', 'refs/heads/' + branch26)
        : '';
    const untouched26 =
      git(xB, 'rev-parse', 'HEAD') === headB26 &&
      git(xB, 'symbolic-ref', 'HEAD') === onB26 &&
      git(xB, 'status', '--porcelain=v1') === statusB26 &&
      fs.readFileSync(path.join(xB, 'not-committed.txt'), 'utf8') === 'work in progress on B\n' &&
      !fs.existsSync(path.join(xB, 'handed.txt'));
    const cA26 = await bOnA(),
      cB26 = await aOnB(),
      ask26 = await R(A, 'handOver', idB).catch(() => null);
    say(
      26,
      press26?.sent === 'going' &&
        done26?.brought.state === 'done' &&
        tip26 === headA26 &&
        untouched26 &&
        cA26?.canSync === false &&
        cB26?.syncable === false &&
        ask26?.sent === 'not_sent',
      steps[25],
      `B's card before: ${offered26 ? offered26.project.rel + ', can bring: ' + offered26.bringable : 'never offered'}; the press: "${press26?.sent}"; it ended: "${done26?.brought.state}"; branch "${branch26}" is at A's newest commit: ${tip26 === headA26}; B's checked-out branch, its status and its uncommitted file as before, and A's new file not in B's folder: ${untouched26}; asking the other computer is not offered (A is told B takes one: ${cA26?.canSync}; B's right for A: ${cB26?.syncable}; A's press: "${ask26?.sent}")`
    );
    try {
      fs.unlinkSync(path.join(xB, 'not-committed.txt'));
    } catch {
      /* gone */
    }

    // 27 ---- a picture and a text file with a prompt.
    // In A's own window two chips are attached and prepared by the page (the
    // picture is made small by its canvas) and go through the window's own call
    // `remote.promptFiles` to the agent of proof 16 on B. B checks them with the rules A used,
    // holds them in memory, and writes them under names of its own when the prompt that names them
    // is taken. Stand-ins: the CLI in B's panel, and the picture's content. Full control goes on
    // for it and off again: the last proof needs only the first switch. First passed 2026-10-10, on
    // its third run (see the two notes below for what the first two runs showed).
    step = 27;

    // An agent of its own on B, started now and idle. Not the agent of proof 16: the stand-in never
    // ends a task it took, so that one is "working" from its last prompt on, and a prompt for a
    // working agent is rightly held on B ("queued") until it is free (window run 2: the files
    // crossed and were saved, and the prompt waited behind that agent's task for the proof's whole
    // minute).
    const FILES27 = 'rc-files';
    await call(B, 'standIn', { paneId: FILES27, name: 'Fern' });
    await R(B, 'setControl', idA, true);
    await until(
      'A is told it may control that agent',
      async () => {
        const c = await bOnA();
        return c?.canControl && rowOn(c, FILES27)?.can ? c : null;
      },
      30000
    ).catch(() => null);
    const before27 = await call(B, 'cameFiles'),
      keys27 = await call(B, 'keys', { paneId: FILES27 }),
      text27 = 'Look at the picture and the notes';

    // The files travel in pieces, at most one every 1.5 seconds and only while A's link is below
    // the line optional traffic stops at: a picture of about 120 KB is 41 pieces, a minute and
    // more. The design gives one file 5 minutes; the proof waits 6 for both (window run 2: one call
    // of this check waits 20 s, which the first form of this proof spent on the whole transfer).
    const go27 = await call(A, 'sendFiles', {
        peer: idB,
        agentId: FILES27,
        text: text27,
        mark: await markOf(FILES27),
      }),
      at27 = Date.now();
    const sent27 = go27?.started
      ? await until(
          "A's files and its prompt are over",
          () => call(A, 'sentFiles'),
          360000,
          1000
        ).catch(() => ({ error: 'the files were still on their way after 6 minutes' }))
      : go27;
    const took27 = Math.round((Date.now() - at27) / 1000);
    const end27 =
      sent27?.sent === 'asked' && sent27.n ? await ended(sent27.n, 60000).catch(() => null) : null;
    const came27 = (await call(B, 'cameFiles')).filter(f => !before27.some(x => x.name === f.name));
    const typed27 = Buffer.from(
      (await call(B, 'keys', { paneId: FILES27 })).slice(keys27.length),
      'hex'
    ).toString('utf8');
    const op27 = end27
      ? end27.state
      : sent27?.n
        ? 'still "' +
          ((await opOf(sent27.n))?.state || 'unknown') +
          '" after a minute; held on B: ' +
          JSON.stringify(await call(B, 'held').catch(() => '?')) +
          '; that panel on B: ' +
          JSON.stringify(await call(B, 'panel', { paneId: FILES27 }).catch(() => '?'))
        : 'never sent';

    // this proof's own agent ends with it
    await call(B, 'stopPanel', { paneId: FILES27 }).catch(() => {});
    sb = await R(B, 'state');
    const line27 =
        (sb.controlLog || []).find(l => l.op === 'prompt' && Array.isArray(l.files)) || {},
      offers27 = (sb.controlLog || []).filter(l => l.op === 'file').length;
    const same27 =
      (sent27?.files || []).length === 2 &&
      sent27.files.every(f =>
        came27.some(c => c.sha === f.sha && c.bytes === f.bytes && c.name.endsWith('.' + f.kind))
      );
    const named27 =
      came27.length === 2 &&
      came27.every(c => typed27.includes(c.path)) &&
      /\[Attached image: [^\]]+-from-another-computer\.jpg\]/.test(typed27) &&
      /\[Attached file: [^\]]+-from-another-computer\.txt\]/.test(typed27) &&
      typed27.includes(text27);
    await R(B, 'setControl', idA, false);
    say(
      27,
      sent27?.sent === 'asked' &&
        !!end27 &&
        ['sent', 'unconfirmed'].includes(end27.state) &&
        sent27.files[0]?.kind === 'jpg' &&
        sent27.files[0].bytes <= 125 * 1024 &&
        sent27.original > 150 * 1024 &&
        same27 &&
        named27 &&
        (line27.files || []).length === 2 &&
        line27.files.every(f => came27.some(c => c.name === f.name)) &&
        offers27 >= 2 &&
        !came27.some(c => /two-copies|notes/.test(c.name)),
      steps[26],
      sent27?.error
        ? 'A could not prepare or send them: ' + sent27.error + ' (after ' + took27 + ' s)'
        : `the files and the prompt took ${took27} s; A's picture: ${Math.round((sent27?.original || 0) / 1024)} KB as drawn, ${Math.round((sent27?.files?.[0]?.bytes || 0) / 1024)} KB as sent (${sent27?.files?.[0]?.kind}); the call: "${sent27?.sent}", the prompt ended: ${op27}; files B saved: ${came27.map(c => c.name + ' ' + c.bytes).join(', ') || 'none'}; the same bytes as A sent: ${same27}; B's agent was sent the words and both paths: ${named27}; B's list names them: ${(line27.files || []).length} (offers listed: ${offers27})`
    );

    // 28 ---- agents messaging agents.
    // WRITTEN 2026-10-10, NOT YET RUN. Two halves, and which one runs is decided by
    // the app itself: (a) the piece is switched off (the window's remote:setControl cannot give the
    // right): full control turned on again from the window with the word of the
    // question that shows the sentence gives no right. B says nowhere that it takes messages, A
    // lists nothing, and a `say` a changed app on A sends with the agent's real ticket is dropped
    // unread: no reply, no byte written, no line. (b) once the window can give it: the same `say`
    // is written into that agent's panel as one paste of B's own mark, the words and the fixed
    // line; A hears `said`; B's list has its line. Not proven here, and why: who started the asking
    // turn, the `tnai ask` command and the answer's way back into it need an agent's own shell
    // (tools/say-paths-test.js and tools/remote-service-test.js hold those with stand-ins; a real
    // CLI is the lead's try). The agent is the stand-in of proof 16, which runs at "Ask first" with
    // the asking mode in its command line.
    step = 28;
    {
      await R(B, 'setControl', idA, false);
      await R(B, 'setControl', idA, true, 'choose say');
      await until(
        'B says again that A may control',
        async () => (await bOnA())?.canControl === true && !!rowOn(await bOnA(), p16.paneId)?.can,
        30000
      );
      const b28 = peerOf(await R(B, 'state'), idA),
        a28 = await bOnA(),
        heard28 = await call(A, 'heard'),
        ticket28 = heard28.known[p16.paneId] || '';
      const keys28 = await call(B, 'keys', { paneId: p16.paneId }),
        lines28 = await linesOnB(),
        replies28 = heard28.replies.length;
      const words28 = 'Which branch are you on?',
        by28 = { name: 'Wren', cli: 'Claude Code' };
      const went28 = await rawFromA({
        t: 'say',
        id: p16.paneId,
        to: ticket28,
        kind: 'ask',
        by: by28,
        text: words28,
      });
      if (b28.talkable !== true) {
        await sleep(3000);
        const after28 = await call(A, 'heard');
        say(
          28,
          b28.control === true &&
            b28.talkable === false &&
            a28.canSay === false &&
            !('m' in (rowOn(a28, p16.paneId) || {})) &&
            /^[0-9a-f]{16}$/.test(ticket28) &&
            went28 === true &&
            after28.replies.length === replies28 &&
            (await call(B, 'keys', { paneId: p16.paneId })) === keys28 &&
            (await linesOnB()) === lines28,
          steps[27],
          `switched off: full control on B for A is ${b28.control}, the right ${b28.talkable}; A is told it takes messages: ${a28.canSay}; the say left A: ${went28}; replies ${after28.replies.length - replies28}, bytes written ${(await call(B, 'keys', { paneId: p16.paneId })).length - keys28.length}, new lines on B ${(await linesOnB()) - lines28}`
        );
      } else {
        const reply28 = await until(
          'B answers the say',
          async () => (await call(A, 'heard')).replies[replies28],
          20000
        ).catch(() => null);
        const got28 = await until(
          "the words are in the agent's panel",
          async () => {
            const k = await call(B, 'keys', { paneId: p16.paneId });
            return k.length > keys28.length ? k.slice(keys28.length) : null;
          },
          20000
        ).catch(() => '');
        const line28 = (await R(B, 'controlLog')).find(e => e.op === 'say');
        const tail28 = require('../../desktop/remote-say.js').TAIL;
        say(
          28,
          a28.canSay === true &&
            rowOn(a28, p16.paneId)?.m === true &&
            !!reply28 &&
            reply28.t === 'said' &&
            reply28.ok === true &&
            got28.includes(hex('[from Wren · Claude Code on ')) &&
            got28.includes(hex('] ' + words28 + tail28)) &&
            !!line28 &&
            /^Wren on /.test(line28.name) &&
            line28.head === words28,
          steps[27],
          `given: A is told it takes messages: ${a28.canSay}, the row says so: ${rowOn(a28, p16.paneId)?.m}; B answered ${reply28 ? reply28.t + ' ' + reply28.word : 'nothing'}; the mark, the words and the fixed line were written: ${got28.includes(hex('] ' + words28 + tail28))}; B's line: ${line28 ? line28.name + ' / ' + line28.agent : 'none'}`
        );
      }
    }

    // 29 ---- the rename limit. While A has full
    // control on B, B's agent may run `tnai rename` once a minute: the name is part of the ticket
    // A's Stop and Interrupt carry. With full control off, the command is as it always was. The
    // `tnai` shim, B's mesh, B's window applying the rename and the "does a paired computer hold
    // full control here" answer are B's own; the agent running the command is the check (its CLI
    // is the stand-in).
    step = 29;
    {
      await until(
        'A may still control B (proof 28 left it on)',
        async () => (await bOnA())?.canControl === true,
        30000
      );
      const first29 = await call(B, 'rename', { paneId: p16.paneId, name: 'Rowan' });
      const second29 = await call(B, 'rename', { paneId: p16.paneId, name: 'Aspen' });
      const seen29 = await until(
        "A lists B's agent under its new name",
        async () => {
          const r = rowOn(await bOnA(), p16.paneId);
          return r && r.name === 'Rowan' ? r : null;
        },
        30000
      ).catch(() => null);
      await R(B, 'setControl', idA, false);
      await until('A may no longer control B', async () => !(await bOnA())?.canControl, 30000);
      const third29 = await call(B, 'rename', { paneId: p16.paneId, name: 'Aspen' });
      await R(B, 'setControl', idA, true, 'choose say');
      await until('A may control B again', async () => (await bOnA())?.canControl === true, 30000);
      say(
        29,
        first29.code === 0 &&
          /Renamed/.test(first29.out) &&
          second29.code !== 0 &&
          /less than a minute ago/.test(second29.out) &&
          /You are still Rowan/.test(second29.out) &&
          !!seen29 &&
          third29.code === 0 &&
          /Renamed/.test(third29.out),
        steps[28],
        `with full control on: first rename "${first29.out.trim().slice(0, 60)}", second "${second29.out.trim().slice(0, 70)}"; A lists the agent as ${seen29 ? seen29.name : 'not Rowan'}; with full control off: "${third29.out.trim().slice(0, 60)}"`
      );
    }

    // 30 ---- a finished task's short result crosses to A and leaves again
    // with B's first switch for A. The task and its end are told to B's app as the real CLI's hooks
    // tell them (the stand-in has no model); the turn, the hand-over in main.js, the message, the
    // cut, A's state and the switch are the two apps'. It stays the LAST proof: the switch takes
    // control away.
    step = 30;
    const did23 = 'Wrote the file; ran the tests';
    await call(B, 'finish', {
      paneId: p16.paneId,
      task: 'Say what you did',
      answer: 'Here is what I did.\n\nTechnically Not report\n- Did: ' + did23,
    });
    let got23 = null;
    try {
      got23 = await until(
        "A shows the result on that agent's row",
        async () => {
          const c = await bOnA(),
            l = rowOn(c, p16.paneId)?.last;
          return l && l.did === did23 ? { last: l, finished: c.finished } : null;
        },
        30000
      );
    } catch {
      /* said below */
    }

    // The answer's text is not in the pushed state: A's window asks for
    // it when it shows it.
    const text26 = got23 ? await R(A, 'reportText', idB, p16.paneId).catch(() => null) : null,
      inState26 = JSON.stringify(await R(A, 'state')).includes('Here is what I did');
    await R(B, 'setDetail', idA, false);
    let gone25 = true;
    try {
      await until(
        'the result is gone from A',
        async () => {
          const c = await bOnA();
          return c && !c.finished && !rowOn(c, p16.paneId)?.last;
        },
        30000
      );
    } catch {
      gone25 = false;
    }

    // taken back with the switch: nothing to read any more
    const after26 = await R(A, 'reportText', idB, p16.paneId).catch(() => null);
    say(
      30,
      !!got23 &&
        got23.last.more === 0 &&
        got23.last.has === true &&
        !('text' in got23.last) &&
        !inState26 &&
        !!text26 &&
        String(text26.text || '').startsWith('Here is what I did.') &&
        text26.at === got23.last.at &&
        text26.got === got23.last.got &&
        text26.more === 0 &&
        got23.finished?.did === did23 &&
        gone25 &&
        after26 === null,
      steps[29],
      got23
        ? `A's row: did "${got23.last.did}", task "${got23.last.task}", has an answer: ${got23.last.has}, its text in the pushed state: ${inState26}, read on demand it starts "${String(text26?.text || '').slice(0, 19)}" (the same result: ${!!text26 && text26.at === got23.last.at}), cut ${got23.last.more}; read after it was taken back: ${after26 === null ? 'nothing' : 'STILL THERE'}; the computer's newest: "${got23.finished?.did}"; after B's first switch for A went off, gone from A: ${gone25}`
        : 'A never showed the result within 30 s'
    );

    // 31 ---- late join: A reads the conversation of B's running agent. B's first switch goes on
    // again (proof 30 left it off): turned on under the sentence that says conversations are
    // read. The conversation record of B's stand-in panel is a stand-in (`talkSeed`: the stand-in
    // CLI writes none); the handle, the shaping, the cut at the pairing, the parts, the link, A's
    // holding and A's drawing are the two apps'. Full control stays off: reading needs only the
    // text switch.
    step = 31;
    {
      const t31 = Date.now();
      const seed31 = [
        { kind: 'you', text: 'OLD-31 before the pairing', at: 1000, pos: 0 },
        { kind: 'you', text: 'ASK-31 fix the cart total', at: t31, pos: 10 },
        {
          kind: 'say',
          text: 'SAY-31 done.\n\nTechnically Not report\n- Did: fixed it\n- Decide: Ship it? | 1. Yes | 2. No',
          at: t31 + 1,
          pos: 20,
        },
        {
          kind: 'ask',
          id: 'q31',
          press: true,
          questions: [{ question: 'Which file?', options: ['a.js', 'b.js'] }],
          at: t31 + 2,
          pos: 30,
        },
        { kind: 'act', verb: 'Started a sub-agent', what: 'look around', at: t31 + 3, pos: 40 },
        { kind: 'result', id: 'r', text: 'RESULT-31 secret output', at: t31 + 4, pos: 50 },
      ];
      await call(B, 'talkSeed', { paneId: p16.paneId, entries: seed31 });
      await R(B, 'setDetail', idA, true);
      const row31 = await until(
        "A's row of B's agent says its conversation can be read",
        async () => {
          const r = rowOn(await bOnA(), p16.paneId);
          return r && r.talk === true && r.sure === true ? r : null;
        },
        30000
      ).catch(() => null);
      await call(A, 'page', { view: 'threads' });
      await until(
        "A opens B's agent from its thread list",
        () => call(A, 'farAgents', { what: 'select', key: idB + '\n' + p16.paneId }),
        15000
      ).catch(() => false);
      const held31 = await until(
        'A holds the conversation',
        async () => {
          const l = await R(A, 'log', idB, p16.paneId).catch(() => null);
          return l && l.entries.length ? l : null;
        },
        20000
      ).catch(() => null);
      const shown31 = await until(
        "A's thread shows it, marked as B's",
        async () => {
          const s = await call(A, 'talkWindow', { what: 'read' });
          return s.shown && s.entries.length && s.from ? s : null;
        },
        10000
      ).catch(() => null);
      const state31 = JSON.stringify(await R(A, 'state'));
      const pressed31 = await call(A, 'talkWindow', { what: 'pressAll' });
      const bLog31 = (await R(B, 'state')).log.filter(e => e.kind === 'read').length;

      // a new turn on B: A asks for what is new, from where its answer ended
      const reads31 = (await call(B, 'talkReads')).length;
      seed31.push({ kind: 'say', text: 'NEW-31 and one more', at: Date.now(), pos: 60 });
      await call(B, 'talkSeed', { paneId: p16.paneId, entries: seed31 });
      await call(B, 'finish', {
        paneId: p16.paneId,
        task: 'one more',
        answer: 'NEW-31 and one more',
      });
      const new31 = await until(
        'the new turn reaches A',
        async () => {
          const l = await R(A, 'log', idB, p16.paneId).catch(() => null);
          return l && l.entries.some(e => /NEW-31/.test(e.text || '')) ? l : null;
        },
        40000
      ).catch(() => null);
      const later31 = (await call(B, 'talkReads')).slice(reads31);

      // B's switch off: A drops what it holds, and the line says the conversation is not shared
      await R(B, 'setDetail', idA, false);
      const gone31 = await until(
        'A no longer holds it',
        async () => (await R(A, 'log', idB, p16.paneId).catch(() => null)) === null,
        20000
      ).catch(() => false);
      say(
        31,
        !!row31 &&
          !!held31 &&
          held31.older === true &&
          !JSON.stringify(held31).includes('OLD-31') &&
          !JSON.stringify(held31).includes('RESULT-31') &&
          held31.entries[0].text.startsWith('ASK-31') &&
          !!shown31 &&
          /As .+ reported it/.test(shown31.from) &&
          shown31.links === 0 &&
          !state31.includes('ASK-31') &&
          pressed31.reached.length === 0 &&
          pressed31.buttons <= 1 &&
          bLog31 === 1 &&
          !!new31 &&
          later31.length >= 1 &&
          later31.every(r => Number.isFinite(r.where.after)) &&
          gone31 === true,
        steps[30],
        `row says readable: ${!!row31}; held: ${held31 ? held31.entries.map(e => e.k).join(',') : 'nothing'} (older cut: ${held31?.older}); drawn: ${shown31 ? shown31.entries.length + ' blocks, "' + shown31.from + '", buttons ' + JSON.stringify(shown31.buttons) : 'no'}; words in A's state: ${state31.includes('ASK-31')}; presses reached ${JSON.stringify(pressed31.reached)}; B's lines ${bLog31}; the new turn: ${!!new31} after ${later31.length} read(s) ${JSON.stringify(later31.map(r => r.where))}; dropped with the switch: ${gone31}`
      );
    }

    // 32 ---- late join, another project open on A: B's agents leave A's thread list, the "On B"
    // group says why in one line, and no conversation can be asked. Then A opens the shared
    // project again and B's agent is listed again.
    step = 32;
    {
      await R(B, 'setDetail', idA, true);
      await until(
        "A lists B's agent as readable again",
        async () => rowOn(await bOnA(), p16.paneId)?.talk === true,
        30000
      ).catch(() => null);
      await call(A, 'project', { dir: zB });
      const away32 = await until(
        "A's thread list hides B's agents and says why",
        async () => {
          const c = await bOnA();
          const s = await call(A, 'talkWindow', { what: 'read' });
          const far = await call(A, 'farAgents', { what: 'read' });
          const listed = far.rows.some(r => r.key === idB + '\n' + p16.paneId);
          return c && !listed && s.why.some(w => /other project|same git project/.test(w))
            ? { c, s, far }
            : null;
        },
        30000
      ).catch(() => null);
      const ask32 = await R(A, 'askLog', idB, p16.paneId, 'first').catch(() => null);
      await call(A, 'project', { dir: xA });
      const back32 = await until(
        "A lists B's agent again in the shared project",
        async () => {
          const far = await call(A, 'farAgents', { what: 'read' });
          return far.rows.some(r => r.key === idB + '\n' + p16.paneId) ? far : null;
        },
        30000
      ).catch(() => null);
      say(
        32,
        !!away32 &&
          away32.far.groups.some(g => g.name === 'On ' + away32.c.name || /^On /.test(g.name)) &&
          !!ask32 &&
          ask32.state === 'not_sent' &&
          !!back32,
        steps[31],
        `another project on A: B's agent listed ${away32 ? 'no' : 'STILL or never checked'}; the line: ${away32 ? JSON.stringify(away32.s.why) : 'none'}; an ask then: ${ask32 ? ask32.state : 'error'}; back in the shared project, listed again: ${!!back32}`
      );
    }

    // 33 ---- late join and the live view at once: with full control on, A watches B's agent and
    // reads its conversation as often as A may for a minute; what B's trust gate let out in any
    // 60 seconds stays under 116 (the relay mutes past 120), and every answer arrived whole.
    step = 33;
    {
      await R(B, 'setControl', idA, true);
      await until(
        'A may watch that agent',
        async () => {
          const c = await bOnA();
          return c?.canWatch && rowOn(c, p16.paneId)?.can && rowOn(c, p16.paneId)?.talk ? c : null;
        },
        30000
      ).catch(() => null);
      const since33 = Date.now();
      const view33 = await R(A, 'view', idB, p16.paneId, await markOf(p16.paneId)).catch(
        () => null
      );
      const states33 = [];
      for (let i = 0; i < 12; i++) {
        const r = await R(A, 'askLog', idB, p16.paneId, 'first').catch(() => null);
        states33.push(r ? r.state : 'error');
        await sleep(5200);
        const l = await R(A, 'log', idB, p16.paneId).catch(() => null);
        if (l) states33.push('held:' + l.state);
      }
      const minute33 = await call(B, 'sentMinute', { since: since33 });
      await R(A, 'unview', 'closed').catch(() => null);
      say(
        33,
        !!view33 &&
          minute33.most > 0 &&
          minute33.most < 116 &&
          (minute33.types.log || 0) > 0 &&
          !states33.includes('held:no_reply'),
        steps[32],
        `view asked: ${!!view33}; B sent at most ${minute33.most} messages in any minute (${JSON.stringify(minute33.types)}); A's asks and holds: ${states33.join(' ')}`
      );
    }
  } catch (e) {
    for (let n = Math.max(step, 1); n <= steps.length; n++)
      say(n, false, steps[n - 1], n === Math.max(step, 1) ? String(e.message || e) : 'not reached');
    for (const a of apps)
      if (a.out.trim())
        console.log(
          '--- ' +
            a.label +
            ' output (end):\n' +
            a.out
              .trim()
              .split(/\r?\n/)
              .filter(l => l && !/DevTools|GPU|gpu_/.test(l))
              .slice(-12)
              .join('\n')
        );
    if (relay)
      console.log('--- relay log (end):\n' + relay.log().split('\n').slice(-12).join('\n'));
  }
  const pids = apps.flatMap(a => a.pids);
  await cleanup();
  const left = pids.filter(alive);
  console.log(
    left.length
      ? 'FAIL app processes still running: ' + left.join(' ')
      : '     both apps and the local server are stopped'
  );
  console.log(failed || left.length ? `REMOTE CHECK: ${failed} FAILED` : 'REMOTE CHECK: PASS');
  clearTimeout(watchdog);
  process.exit(failed || left.length ? 1 : 0);
})();
