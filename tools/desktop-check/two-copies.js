// Technically Not tools · desktop-check/two-copies.js — what a check needs to run TWO copies of
// the app on one PC and drive them: the one-check-at-a-time lock, two throwaway profiles, starting
// and quitting a copy, and calling the commands of tests/remote-two.main.js in it.
//
// Used by own-relay-check.js. remote-check.js has the same helpers inline (it was written first and
// is left as it is); a change to how a copy is started belongs in both until that file uses this
// one.
//
// Nothing in the app loads this file.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const electron = require(path.join(root, 'node_modules', 'electron'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Asks `question` again and again until it answers something true, and hands that back. Throws
// with `what` in the message when the time is up.
async function until(what, question, ms = 15000, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const answer = await question();
    if (answer) return answer;
    if (Date.now() > end) throw new Error('timed out: ' + what);
    await sleep(every);
  }
}

// Is a process with that id running? (EPERM: it runs, but belongs to someone else.)
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// ---- one desktop check at a time: the same lock file as check.js and remote-check.js ----

const LOCK = path.join(os.tmpdir(), 'tnai-desktop-check.lock');

// Waits until no other desktop check runs on this PC, then holds the lock under `name`.
async function takeLock(name) {
  let told = false;
  for (;;) {
    try {
      const mine = { pid: process.pid, tests: [name], at: new Date().toISOString() };
      fs.writeFileSync(LOCK, JSON.stringify(mine), { flag: 'wx' });
      return;
    } catch {
      /* someone holds it: looked at below */
    }
    let holder = null;
    let isFolder = false;
    try {
      isFolder = fs.statSync(LOCK).isDirectory();
      if (!isFolder) holder = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    } catch {
      /* unreadable: treated as left over */
    }
    if (isFolder) {
      holder = { pid: '?', tests: ['a check started from PowerShell (lock folder)'] };
    } else if (!holder || !alive(holder.pid)) {
      // left over from a check that ended without cleaning up
      try {
        fs.unlinkSync(LOCK);
      } catch {
        /* gone already */
      }
      await sleep(200);
      continue;
    }
    if (!told) {
      const which = (holder.tests || []).join(' ');
      console.log(
        `Waiting: another desktop check is running (pid ${holder.pid}: ${which}). Checks run one at a time on this PC.`
      );
      told = true;
    }
    await sleep(3000);
  }
}

// Gives the lock back, but only when this process holds it.
function dropLock() {
  try {
    if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === process.pid) fs.unlinkSync(LOCK);
  } catch {
    /* not ours, or gone */
  }
}

// ---- the copies of the app ----

// A port nothing listens on right now.
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// Ends a process and everything it started.
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch {
    /* gone already */
  }
}

// The folder that holds both profiles, and the list of copies. `prefix` names the folder in the
// system's temp folder.
function createCopies(prefix) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const apps = [];

  // One copy of the app, not started yet. Its profile folder is kept between starts.
  function makeApp(label) {
    const app = {
      label,
      id: '',
      profile: path.join(base, label),
      port: 0,
      child: null,
      out: '',
      pids: [],
    };
    apps.push(app);
    return app;
  }

  // Starts that copy from source and waits until its window is ready to be driven.
  async function startApp(app, extraEnv) {
    app.port = await freePort();
    app.out = '';
    const env = {
      ...process.env,
      ...extraEnv,
      TNAI_SELFTEST: 'remote-two',
      TNAI_REMOTE_CHECK_PROFILE: app.profile,
      TNAI_REMOTE_CHECK_PORT: String(app.port),
      TNAI_HOME_SKILLS_DIR: path.join(base, 'home-skills'),
    };

    // settings of the shell this check was started from must not reach the copies
    const notPassedOn = [
      'TNAI_CHECK_LIMIT_MS',
      'ELECTRON_RUN_AS_NODE',
      'TNAI_CHECK_PROJECT',
      'TNAI_CHECK_BY_HAND',
    ];
    for (const name of notPassedOn) delete env[name];

    // The first -r keeps the profile between starts; the second is the check's own half in the
    // main process (the commands this file calls).
    const args = [
      '-r',
      path.join(__dirname, 'remote-check-preload.js'),
      '-r',
      path.join(__dirname, 'tests', 'remote-two.main.js'),
      root,
    ];
    const child = spawn(electron, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    app.child = child;
    app.pids.push(child.pid);
    const keep = text => {
      app.out = (app.out + text).slice(-6000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    await until(
      app.label + ' is up',
      async () => {
        if (child.exitCode !== null)
          throw new Error(app.label + ' exited while starting (code ' + child.exitCode + ')');
        try {
          return (await call(app, 'ping')).ready;
        } catch {
          return false;
        }
      },
      90000,
      300
    );
    app.upAt = Date.now();
  }

  // Asks that copy to quit, and ends it by force when it has not left in time. → how it left.
  async function quitApp(app, ms = 15000) {
    const child = app.child;
    if (!child || child.exitCode !== null) return 'gone';
    let how = 'killed';
    try {
      how = await call(app, 'quit');
    } catch {
      /* it does not answer: ended by force below */
    }
    const end = Date.now() + ms;
    while (child.exitCode === null && Date.now() < end) await sleep(100);
    if (child.exitCode === null) {
      killTree(child);
      how = 'killed';
      await sleep(500);
    }
    return how;
  }

  // Removes both profiles. Windows can hold a file a moment after its program ended.
  async function removeBase() {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        fs.rmSync(base, { recursive: true, force: true });
      } catch {
        /* tried again */
      }
      if (!fs.existsSync(base)) return true;
      await sleep(250);
    }
    return false;
  }

  // The last lines a copy printed, without Chromium's own noise: for a failure report.
  function lastOutput(app, lines = 12) {
    return app.out
      .trim()
      .split(/\r?\n/)
      .filter(line => line && !/DevTools|GPU|gpu_/.test(line))
      .slice(-lines)
      .join('\n');
  }

  return { base, apps, makeApp, startApp, quitApp, removeBase, lastOutput };
}

// One command of tests/remote-two.main.js in that copy. → its value, or throws with its error.
async function call(app, cmd, args) {
  const response = await fetch(`http://127.0.0.1:${app.port}/`, {
    method: 'POST',
    body: JSON.stringify({ cmd, args }),
    signal: AbortSignal.timeout(20000),
  });
  const out = await response.json();
  if (!out?.ok) throw new Error(app.label + ' ' + cmd + ': ' + (out?.error || 'failed'));
  return out.value;
}

// A real remote:* call from that copy's window, for the calls that answer { ok, value }. → the
// value, or throws with the call's error code.
async function remoteCall(app, fn, ...args) {
  const answer = await call(app, 'remote', { fn, args });
  if (!answer?.ok)
    throw new Error(app.label + ' remote.' + fn + ' refused: ' + (answer?.error?.code || '?'));
  return answer.value;
}

// The paired computer with that id in a remote state, or null.
function peerOf(state, id) {
  return state.computers.find(computer => computer.id === id) || null;
}

module.exports = {
  root,
  sleep,
  until,
  alive,
  takeLock,
  dropLock,
  freePort,
  killTree,
  createCopies,
  call,
  remoteCall,
  peerOf,
};
