/*
 * Technically Not tools · desktop-check/tests/pane-cleanup.main.js — Main-process side of
 * pane-cleanup.js. Each case starts hidden background `ping`s (each case its own ping count, so
 * they are found by command line even after their parent is gone) and reports which are still alive
 * afterwards (none should be): close / quit — a PowerShell pane through pty-service, then ptys.stop
 * / ptys.stopAll; orphan — started through a cmd.exe that exits at once (parentless, which taskkill
 * /T can't find), then the pane closes; exit — the pane's shell exits by itself; crash — a separate
 * process (Technically Not's executable in node mode) runs process-guard.js with a shell, and is
 * hard-killed like Task Manager would; reap — a later start ends a recorded root only when pid AND
 * creation time match.
 */
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const ptys = require('../../../desktop/pty-service');

const windows = process.platform === 'win32';
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const ps = command =>
  execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
const pings = n =>
  windows
    ? ps(
        `(Get-CimInstance Win32_Process -Filter "Name='ping.exe'" | Where-Object CommandLine -match ' -n ${n} ').ProcessId`
      )
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
    : sleeps(n);

// mac/Linux: the background process is `sleep <n>`, found in /proc by its exact command line (its
// parent may be gone).
const sleeps = n =>
  fs
    .readdirSync('/proc')
    .filter(d => /^\d+$/.test(d))
    .filter(d => {
      try {
        return fs.readFileSync('/proc/' + d + '/cmdline', 'utf8') === 'sleep\0' + n + '\0';
      } catch {
        return false;
      }
    })
    .map(Number);

// bash: a background job; orphan = started from a subshell that exits at once (parentless, in no
// job the shell knows).
const nixCmd = (reason, n) =>
  reason === 'orphan'
    ? `(sleep ${n} &)`
    : reason === 'exit'
      ? `sleep ${n} & sleep 2; exit`
      : `sleep ${n} &`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  let v;
  for (let t = 0; t < ms; t += 250) {
    v = fn();
    if (v.length) return v;
    await wait(250);
  }
  return v;
};
const COUNT = { close: 301, quit: 302, orphan: 303, exit: 304, crash: 305 };
const startPing = n =>
  `Start-Process ping -ArgumentList '-n','${n}','127.0.0.1' -WindowStyle Hidden`;

// A process in node mode (Technically Not's own executable) that prints JSON lines; stdout is read
// until `want` answers.
function nodeChild(code, want) {
  const child = spawn(process.execPath, ['-e', code], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  let out = '';
  const answer = new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 30000);
    child.stdout.on('data', d => {
      out += d;
      for (const line of out.split('\n')) {
        try {
          const m = JSON.parse(line);
          if (want(m)) {
            clearTimeout(timer);
            resolve(m);
          }
        } catch {}
      }
    });
  });
  return { child, answer };
}
const GUARD = JSON.stringify(path.join(__dirname, '..', '..', '..', 'desktop', 'process-guard.js'));

module.exports = () => ({
  async run(reason) {
    if (reason === 'crash') return crash();
    if (reason === 'reap') return reap();
    const n = COUNT[reason],
      paneId = 'cleanup-' + reason;
    const { pid } = await ptys.start({ paneId, agent: 'Terminal', cwd: os.tmpdir() });
    await wait(1500);
    const cmd =
      reason === 'orphan'
        ? `Start-Process cmd -ArgumentList '/c','start','/b','ping','-n','${n}','127.0.0.1' -WindowStyle Hidden`
        : startPing(n);
    if (windows) ptys.write(paneId, cmd + (reason === 'exit' ? '; exit' : '') + '\r');
    else ptys.write(paneId, nixCmd(reason, n) + '\r');
    const kids = await until(() => pings(n));
    if (reason === 'quit') ptys.stopAll();
    else if (reason !== 'exit') ptys.stop(paneId);
    await wait(reason === 'exit' ? 3000 : 1500);
    return { pid, kids, shellAlive: alive(pid), kidsAlive: kids.filter(alive) };
  },
});

// Technically Not killed outright: no quit event runs, yet the pane's shell and its background ping
// end (the helper's jobs close with it).
async function crash() {
  if (!windows) return crashNix();
  const n = COUNT.crash,
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-guard-'));
  const code = `const g=require(${GUARD}),{spawn}=require('child_process');g.init(${JSON.stringify(dir)});
    const sh=spawn('powershell.exe',['-NoProfile','-Command',${JSON.stringify(startPing(n) + '; Start-Sleep 300')}],{windowsHide:true,stdio:'ignore'});
    g.track(sh.pid).then(ok=>console.log(JSON.stringify({ok,shell:sh.pid,helper:g.helperPid()})));setInterval(()=>{},1e6);`;
  const { child, answer } = nodeChild(code, m => 'shell' in m);
  const m = await answer;
  if (!m?.ok) {
    try {
      child.kill();
    } catch {}
    return {
      pid: m?.shell || 0,
      kids: [],
      shellAlive: false,
      kidsAlive: [],
      error: 'the guard did not track the shell',
    };
  }
  const kids = await until(() => pings(n));
  child.kill(); // TerminateProcess: no exit handlers run in the killed process
  await wait(2500);
  return {
    pid: m.shell,
    kids,
    shellAlive: alive(m.shell),
    kidsAlive: kids.filter(alive),
    helperAlive: alive(m.helper),
  };
}

// Next start after a crash: a recorded root with the right creation time is ended with its tree;
// the same pid with another creation time is left alone.
async function reap() {
  if (!windows)
    return {
      skip: 'Windows only: process-guard.js records pane roots for its Job Objects; mac/Linux panes end with their terminal session (pty-service.js)',
    };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-guard-'));
  const start = n =>
    Number(
      ps(
        `(Start-Process ping -ArgumentList '-n','${n}','127.0.0.1' -WindowStyle Hidden -PassThru).Id`
      )
    );
  const created = pid => ps(`(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()`);
  const matched = start(306),
    other = start(307);
  const rec = [
    { pid: matched, created: created(matched) },
    { pid: other, created: String(BigInt(created(other)) - 1n) },
  ];
  fs.writeFileSync(path.join(dir, 'pane-processes.json'), JSON.stringify(rec));
  const { child, answer } = nodeChild(
    `require(${GUARD}).init(${JSON.stringify(dir)}).then(n=>{console.log(JSON.stringify({reaped:n}));process.exit()})`,
    m => 'reaped' in m
  );
  const m = await answer;
  try {
    child.kill();
  } catch {}
  await wait(500);
  const result = {
    reaped: m?.reaped ?? -1,
    matchedAlive: alive(matched),
    otherAlive: alive(other),
    recordCleared: fs.readFileSync(path.join(dir, 'pane-processes.json'), 'utf8') === '[]',
  };
  try {
    process.kill(other);
  } catch {}
  return result;
}

// mac/Linux: no guard helper. A process holding a pane's pty (node-pty in Technically Not's
// executable in node mode) is hard-killed (SIGKILL, no exit handlers run): the kernel hangs up the
// pane's terminal, and the shell and its background job end with it.
async function crashNix() {
  const n = COUNT.crash;
  const code = `const pty=require(${JSON.stringify(require.resolve('node-pty'))});
    const p=pty.spawn('/bin/bash',['-i'],{name:'xterm-256color',cols:80,rows:24,cwd:${JSON.stringify(os.tmpdir())},env:process.env});
    setTimeout(()=>{p.write('sleep ${n} &\\r');console.log(JSON.stringify({ok:true,shell:p.pid}));},1000);setInterval(()=>{},1e6);`;
  const { child, answer } = nodeChild(code, m => 'shell' in m);
  const m = await answer;
  if (!m?.ok) {
    try {
      child.kill('SIGKILL');
    } catch {}
    return {
      pid: 0,
      kids: [],
      shellAlive: false,
      kidsAlive: [],
      error: 'the pty process did not start a shell',
    };
  }
  const kids = await until(() => pings(n));
  child.kill('SIGKILL');
  await wait(2500);
  return {
    pid: m.shell,
    kids,
    shellAlive: alive(m.shell),
    kidsAlive: kids.filter(alive),
    helperAlive: false,
  };
}
