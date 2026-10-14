/*
 * Technically Not desktop · process-guard.js — No pane process outlives its pane or Technically
 * Not, however Technically Not ends (Windows). Every pane's process tree goes into its own Job
 * Object (kill-on-close), held by one small hidden helper (Windows PowerShell running the C# below)
 * that Technically Not starts and talks to over stdin. end(pid) terminates the pane's job:
 * everything the pane started, also processes whose parent already exited (which taskkill /T can't
 * find). When Technically Not ends in any way (quit, crash, Task Manager, taskkill), the helper's
 * stdin closes, it exits, and Windows kills every job it held. Tracked roots are also recorded (pid
 * + creation time) in <userData>/pane-processes.json, so the next start ends any still alive; only
 * a process with exactly that pid and creation time, so an unrelated process that reused the pid is
 * never touched. Plain Node (no electron import): tools/desktop-check tests run it in a child
 * process to prove the hard-kill case.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HELPER = String.raw`
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class TnaiGuard {
  const uint TERMINATE = 0x0001, SET_QUOTA = 0x0100, QUERY_LIMITED = 0x1000, KILL_ON_JOB_CLOSE = 0x2000;
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a, b; public uint LimitFlags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
  [StructLayout(LayoutKind.Sequential)] struct IOC { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IOC Io; public UIntPtr p, j, pp, jp; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct PE { public uint size, usage, pid; public IntPtr heap; public uint module, threads, ppid; public int pri; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string exe; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr a, string n);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT info, uint len);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr proc, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long c, out long e, out long k, out long u);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr s, ref PE e);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr s, ref PE e);

  static long Created(uint pid) {
    IntPtr h = OpenProcess(QUERY_LIMITED, false, pid); if (h == IntPtr.Zero) return 0;
    long c, e, k, u; bool ok = GetProcessTimes(h, out c, out e, out k, out u); CloseHandle(h); return ok ? c : 0;
  }
  // The root and its live descendants. A child counts only if it started after its parent, so a stale parent pid that Windows reused never links an unrelated process.
  static List<uint> Tree(uint root, long rootCreated) {
    var parents = new List<uint[]>();
    IntPtr snap = CreateToolhelp32Snapshot(2, 0);
    if (snap != new IntPtr(-1)) {
      var e = new PE(); e.size = (uint)Marshal.SizeOf(typeof(PE));
      for (bool more = Process32FirstW(snap, ref e); more; more = Process32NextW(snap, ref e)) parents.Add(new uint[] { e.pid, e.ppid });
      CloseHandle(snap);
    }
    var tree = new List<uint> { root }; var created = new Dictionary<uint, long> { { root, rootCreated } };
    for (int i = 0; i < tree.Count; i++) foreach (var pp in parents) {
      if (pp[1] != tree[i] || pp[0] == tree[i] || created.ContainsKey(pp[0])) continue;
      long c = Created(pp[0]); if (c == 0 || c < created[tree[i]]) continue;
      created[pp[0]] = c; tree.Add(pp[0]);
    }
    return tree;
  }
  static IntPtr NewJob() {
    IntPtr job = CreateJobObjectW(IntPtr.Zero, null); if (job == IntPtr.Zero) return job;
    var info = new EXT(); info.Basic.LimitFlags = KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(EXT)));
    return job;
  }
  // Puts the tree in the job; a process that can't join (another job forbids it) is remembered to be ended directly.
  static int Assign(IntPtr job, List<uint> tree, List<uint> outside) {
    int n = 0;
    foreach (var pid in tree) {
      IntPtr h = OpenProcess(TERMINATE | SET_QUOTA | QUERY_LIMITED, false, pid); if (h == IntPtr.Zero) continue;
      if (AssignProcessToJobObject(job, h)) n++; else if (outside != null) outside.Add(pid);
      CloseHandle(h);
    }
    return n;
  }
  static void Kill(uint pid) { IntPtr h = OpenProcess(TERMINATE, false, pid); if (h != IntPtr.Zero) { TerminateProcess(h, 1); CloseHandle(h); } }
  public static void Run() {
    var jobs = new Dictionary<string, IntPtr>(); var outside = new Dictionary<string, List<uint>>();
    Console.Out.WriteLine("ready");
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      var p = line.Trim().Split(' ');
      try {
        if (p[0] == "track" && p.Length == 3) {
          uint pid = uint.Parse(p[2]); long c = Created(pid);
          if (c == 0) { Console.Out.WriteLine("gone " + p[1]); continue; }
          IntPtr job = NewJob(); if (job == IntPtr.Zero) { Console.Out.WriteLine("error " + p[1]); continue; }
          var rest = new List<uint>(); int n = Assign(job, Tree(pid, c), rest);
          jobs[p[1]] = job; outside[p[1]] = rest;
          Console.Out.WriteLine("tracked " + p[1] + " " + pid + " " + c + " " + n);
        } else if (p[0] == "end" && p.Length == 2) {
          IntPtr job;
          if (jobs.TryGetValue(p[1], out job)) { TerminateJobObject(job, 1); CloseHandle(job); jobs.Remove(p[1]); foreach (var pid in outside[p[1]]) Kill(pid); outside.Remove(p[1]); }
          Console.Out.WriteLine("ended " + p[1]);
        } else if (p[0] == "reap" && p.Length == 3) {
          uint pid = uint.Parse(p[1]); long c = long.Parse(p[2]); int n = 0;
          if (c != 0 && Created(pid) == c) {
            var rest = new List<uint>(); var tree = Tree(pid, c); IntPtr job = NewJob();
            n = tree.Count; Assign(job, tree, rest); TerminateJobObject(job, 1); CloseHandle(job); foreach (var r in rest) Kill(r);
          }
          Console.Out.WriteLine("reaped " + p[1] + " " + n);
        }
      } catch (Exception) { Console.Out.WriteLine("error " + (p.Length > 1 ? p[1] : "")); }
    }
  }
}`;
const SCRIPT =
  "$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n" +
  HELPER +
  "\n'@\n[TnaiGuard]::Run()\n";

let dir = '',
  helper = null,
  ready = false,
  failures = 0,
  helperWritten = false,
  stopping = false,
  buffer = '';

// pid -> creation time (Windows FILETIME), the pane roots whose jobs the helper holds
const tracked = new Map();
const waiting = new Map(); // 'op pid' -> [resolve]
const recordFile = () => path.join(dir, 'pane-processes.json');

function saveRecords() {
  if (!dir) return;
  const file = recordFile(),
    temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(
      temp,
      JSON.stringify([...tracked].map(([pid, created]) => ({ pid, created })))
    );
    fs.renameSync(temp, file);
  } catch {}
}

function settle(key, value) {
  const list = waiting.get(key);
  if (!list) return;
  waiting.delete(key);
  for (const resolve of list) resolve(value);
}

function onLine(line) {
  const [op, a, b, c] = line.trim().split(' ');
  if (op === 'ready') {
    ready = true;
    failures = 0;
    return;
  }
  if (op === 'tracked') {
    tracked.set(Number(a), c);
    saveRecords();
    return settle('track ' + a, true);
  }
  if (op === 'gone' || op === 'error') {
    settle('track ' + a, false);
    return settle('end ' + a, false);
  }
  if (op === 'ended') {
    if (tracked.delete(Number(a))) saveRecords();
    return settle('end ' + a, true);
  }
  if (op === 'reaped') return settle('reap ' + a, Number(b) || 0);
}

function ensureHelper() {
  // PowerShell blocked here: pty-service falls back to taskkill /T
  if (process.platform !== 'win32' || stopping || failures >= 3) return null;
  if (helper) return helper;
  const exe = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );

  // A plain script file (not -EncodedCommand, which security tools treat as obfuscation), rewritten
  // each start so it always matches this build.
  const script = path.join(dir || require('os').tmpdir(), 'process-guard.ps1');
  try {
    if (!helperWritten) {
      fs.writeFileSync(script, SCRIPT);
      helperWritten = true;
    }
    helper = spawn(
      exe,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
    );
  } catch {
    failures++;
    helper = null;
    return null;
  }
  const me = helper;
  me.stdout.setEncoding('utf8');
  me.stdout.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      onLine(line);
    }
  });
  me.stdin.on('error', () => {});
  const lost = () => {
    if (helper !== me) return;

    // Windows ended every job with the helper, so the tracked panes are gone too. The next pane
    // starts a new helper.
    if (!ready) failures++;
    helper = null;
    ready = false;
    buffer = '';
    tracked.clear();
    saveRecords();
    for (const key of [...waiting.keys()]) settle(key, false);
  };
  me.on('exit', lost);
  me.on('error', lost);
  return me;
}

// One request line; resolves with the helper's answer, or false/0 if it doesn't answer in time.
function ask(op, arg, line, timeout) {
  const h = ensureHelper();
  if (!h) return Promise.resolve(false);
  const key = op + ' ' + arg;
  return new Promise(resolve => {
    const timer = setTimeout(() => settle(key, false), timeout);
    timer.unref?.();
    waiting.set(key, [
      ...(waiting.get(key) || []),
      value => {
        clearTimeout(timer);
        resolve(value);
      },
    ]);
    try {
      h.stdin.write(line + '\n');
    } catch {
      settle(key, false);
    }
  });
}

module.exports = {
  // dir: where the tracked roots are recorded (userData). Starts the helper and ends what an
  // earlier run of this Technically Not left behind.
  init(folder) {
    dir = folder || '';
    if (process.platform !== 'win32') return Promise.resolve(0);
    let old = [];
    try {
      old = JSON.parse(fs.readFileSync(recordFile(), 'utf8'));
    } catch {}
    saveRecords(); // this run's list starts empty
    ensureHelper();
    return Promise.all(
      (Array.isArray(old) ? old : [])
        .filter(r => r && r.pid > 0 && /^\d+$/.test(String(r.created)))
        .map(r => ask('reap', r.pid, 'reap ' + (r.pid | 0) + ' ' + r.created, 30000))
    ).then(counts => counts.reduce((a, n) => a + (n || 0), 0));
  },
  // A pane's root process just started: it and anything it starts join the pane's job. Resolves
  // true once it is in.
  track(pid) {
    return pid > 0
      ? ask('track', pid, 'track ' + (pid | 0) + ' ' + (pid | 0), 30000)
      : Promise.resolve(false);
  },
  isTracked: pid => tracked.has(Number(pid)),
  // Ends everything in the pane's job (the root too, if it still runs). Resolves once the processes
  // were told to end.
  end(pid) {
    return pid > 0 && (tracked.has(Number(pid)) || waiting.has('track ' + pid))
      ? ask('end', pid, 'end ' + (pid | 0), 5000)
      : Promise.resolve(false);
  },
  // Technically Not is quitting: the helper exits when its stdin closes, and Windows ends every job
  // it held.
  stop() {
    stopping = true;
    try {
      helper?.stdin.end();
    } catch {}
  },
  helperPid: () => helper?.pid || 0,
};
