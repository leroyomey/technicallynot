// Technically Not · stall-log.js — Logs main-process event-loop stalls over 100 ms (a 250 ms timer
// that fired more than 100 ms late), so future freezes can be traced to a time. With a folder
// (userData), each stall is also appended to stalls.log there (installed builds have no visible
// console); over MAX_BYTES it moves to stalls.old.log, so at most about twice that is kept.
const fs = require('fs');
const path = require('path');
const STALL_MS = 100;
const TICK_MS = 250;
const MAX_BYTES = 256 * 1024;

// What blocked: named sections of main-process work (IPC handlers in main.js, the file watcher's
// batch) report how long they ran without a break, and a stall line names the longest one since the
// last tick. Without it the log said only when, never what (2026-10-04: 819 stalls in five days,
// none traceable). Only sections of 20 ms or more are kept; a stall with no name was caused outside
// the named sections.
let busy = null; // { name, ms }
let inner = 0; // the longest section reported while the current timer callback runs (nameTimers)

// How long the loop ran inside timer, setImmediate and event callbacks since the last tick
// (outermost ones only). A stall with no named section and little time in callbacks was not a
// callback of ours: Electron's own work on this thread (a window, a picture, IPC routing), a
// promise's continuation or loading a module.
let depth = 0;
let inCallbacks = 0;

function ran(name, ms) {
  if (ms > inner) inner = ms;
  if (ms >= 20 && (!busy || ms > busy.ms)) busy = { name, ms: Math.round(ms) };
}

// fn wrapped so that its own run time (not what it awaits) is reported under `name`.
const timed =
  (name, fn) =>
  (...args) => {
    const t = performance.now();
    try {
      return fn(...args);
    } finally {
      ran(name, performance.now() - t);
    }
  };

// An async fn in pieces: `timed` sees only the run up to the first await, and the hook server's and
// pty:start's work comes after theirs. fn gets a span as its first argument and writes `await
// span.rest(promise)` where it waits: the run before each wait and after the last one is reported
// under span.name (fn may set a more exact name once it knows it). Waiting itself is never counted.
const sections =
  (name, fn) =>
  (...args) => {
    const span = {
      name,
      t: performance.now(),
      rest: async p => {
        span.stop();
        try {
          return await p;
        } finally {
          span.t = performance.now();
        }
      },
      stop() {
        if (span.t !== null) {
          ran(span.name, performance.now() - span.t);
          span.t = null;
        }
      },
    };
    let out;
    try {
      out = fn(span, ...args);
    } finally {
      span.stop();
    }

    // the run after the last wait
    if (out && typeof out.then === 'function') out.then(span.stop, span.stop);
    return out;
  };

// Timer callbacks (setTimeout, setInterval) had no name at all: the terminal output flush, session
// lookups, debounced saves and every other timer in the main process ran outside the named sections
// (2026-10-07: 176 of 279 stalls, 63% of the blocked time, said "no named section"). From start()
// on, each callback's own run is timed and one of 20 ms or more is reported as `timer <function>
// <file>:<line>` (where the timer was set), unless a named section inside it covers half of the run
// or more (the more exact name is kept). The callback, its arguments, its `this` and the timer
// object returned are unchanged; the place is noted when the timer is set and only read if the
// callback was slow.
let timersNamed = false;

function nameTimers() {
  if (timersNamed) return;
  timersNamed = true;
  const custom = require('util').promisify.custom;
  for (const key of ['setTimeout', 'setInterval']) {
    const real = global[key];
    const named = function (fn, ...rest) {
      if (typeof fn !== 'function') return real(fn, ...rest);
      const at = {},
        limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 1;
      Error.captureStackTrace(at, named);
      Error.stackTraceLimit = limit;
      return real(
        function (...args) {
          const t = performance.now();
          depth++;
          inner = 0;
          try {
            return fn.apply(this, args);
          } finally {
            const ms = performance.now() - t;
            if (--depth === 0) inCallbacks += ms;
            if (ms >= 20 && inner * 2 < ms) ran('timer ' + setAt(fn, at), ms);
          }
        },
        ...rest
      );
    };
    const promised = Object.getOwnPropertyDescriptor(real, custom);

    // util.promisify(setTimeout) still works
    if (promised) Object.defineProperty(named, custom, promised);
    global[key] = named;
  }
  nameImmediates();
}

// setImmediate callbacks had no name either; they are named the same way as timers, as `immediate
// <function> <file>:<line>`. A separate function because setImmediate takes no delay.
function nameImmediates() {
  const real = global.setImmediate;
  const custom = require('util').promisify.custom;
  const named = function (fn, ...rest) {
    if (typeof fn !== 'function') return real(fn, ...rest);
    const at = {},
      limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 1;
    Error.captureStackTrace(at, named);
    Error.stackTraceLimit = limit;
    return real(
      function (...args) {
        const t = performance.now();
        depth++;
        inner = 0;
        try {
          return fn.apply(this, args);
        } finally {
          const ms = performance.now() - t;
          if (--depth === 0) inCallbacks += ms;
          if (ms >= 20 && inner * 2 < ms) ran('immediate ' + setAt(fn, at), ms);
        }
      },
      ...rest
    );
  };
  const promised = Object.getOwnPropertyDescriptor(real, custom);

  // util.promisify(setImmediate) still works
  if (promised) Object.defineProperty(named, custom, promised);
  global.setImmediate = named;
}

// Event listeners were the largest unnamed part left (2026-10-14: 83 stalls since that morning
// named no section although the process ran most of the time): a child process ending (git, the
// CLI checks), a file watcher, a socket's data, an Electron event. Every emit is timed and one of
// 20 ms or more is reported as `event <object kind>.<event name>`, unless a named section inside
// it covers half of the run or more. An emit inside another one keeps the outer one's count right,
// so only the most exact name is kept. Cost: two clock reads per emit; the name is built only when
// an emit was slow. Listeners, arguments, the return value and thrown errors are unchanged.
let eventsNamed = false;

function nameEvents() {
  if (eventsNamed) return;
  eventsNamed = true;
  const proto = require('events').EventEmitter.prototype;
  const real = proto.emit;
  proto.emit = function emit(type, ...args) {
    const outer = inner;
    inner = 0;

    // A child process's listeners are noted before the emit: a once-listener is gone after it,
    // and child processes emit rarely, so the copy costs nothing that matters.
    const before = this.spawnfile === undefined ? null : this.listeners(type);
    const t = performance.now();
    depth++;
    try {
      return real.call(this, type, ...args);
    } finally {
      const ms = performance.now() - t;
      if (--depth === 0) inCallbacks += ms;
      if (ms >= 20 && inner * 2 < ms) ran('event ' + eventName(this, type, before), ms);

      // the outer section sees this run as covered by a named one
      inner = Math.max(outer, ms >= 20 ? ms : inner);
    }
  };
}

// `<object kind>.<event name>`, then for a child process the program it ran (2026-10-14: `event
// ChildProcess.close 632 ms` could not say whose process it was), then the names of the listeners
// that have one (internal ones like `exithandler` too: they tell execFile from spawn).
function eventName(emitter, type, listeners) {
  let kind = '';
  let program = '';
  let names = '';
  try {
    kind = emitter?.constructor?.name || '';
    if (typeof emitter?.spawnfile === 'string')
      program = path.basename(emitter.spawnfile).replace(/\.(exe|cmd|bat)$/i, '');
    names = (listeners || emitter.listeners(type))
      .map(listener => listener.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(',');
  } catch {}
  return [(kind || 'emitter') + '.' + String(type), program, names]
    .filter(Boolean)
    .join(' ')
    .slice(0, 80);
}

function setAt(fn, at) {
  let where = '';
  try {
    where =
      (/([^\\/()]+:\d+):\d+\)?\s*$/.exec(String(at.stack).split('\n')[1] || '') || [])[1] || '';
  } catch {}
  return [fn.name, where].filter(Boolean).join(' ').slice(0, 80) || 'callback';
}

// Garbage collection pauses, from Node's own record of them: without it a pause could not be told
// from our code running.
let gcSeen = 0,
  gcLongest = 0,
  gcWatch = null;
const gcNote = list => {
  for (const e of list) {
    gcSeen += e.duration;
    if (e.duration > gcLongest) gcLongest = e.duration;
  }
};

function watchGc() {
  if (gcWatch) return;
  try {
    const { PerformanceObserver } = require('perf_hooks');
    gcWatch = new PerformanceObserver(items => gcNote(items.getEntries()));
    gcWatch.observe({ entryTypes: ['gc'] });
  } catch {
    gcWatch = null;
  }
}

// Pauses since the last call, in ms ({ total, longest }); the records still waiting with the
// observer are taken first.
function gcSince() {
  try {
    gcNote(gcWatch?.takeRecords?.() || []);
  } catch {}
  const out = { total: Math.round(gcSeen), longest: Math.round(gcLongest) };
  gcSeen = 0;
  gcLongest = 0;
  return out;
}

// Chromium keeps a copy of every page for screen readers and other programs that read the screen
// (UI Automation) once one of them asks, and keeping it up to date is Electron's own work on this
// thread: a stall line says when it is on. Read only when a stall is written; outside Electron
// (the plain Node checks) it is never on.
function accessibilityOn() {
  try {
    return !!require('electron').app?.isAccessibilitySupportEnabled?.();
  } catch {
    return false;
  }
}

function start(dir) {
  const file = dir ? path.join(dir, 'stalls.log') : '';
  const every = setInterval; // the stall timer itself is not one of the named timers
  nameTimers();
  nameEvents();
  watchGc();
  let last = Date.now(),
    writing = false,
    pending = '',
    cpu = process.cpuUsage();

  // The main thread's own CPU time, apart from the process's other threads (Node 23.9+). With
  // the process's figure it tells the kinds of unnamed stall apart (2026-10-21, bug sweep group
  // 3): both near 0 = the process did not run (the PC asleep or starved); the main thread near the
  // blocked time = our code on it (after an `await`, or Electron's own work); the main thread near
  // 0 with the process busy = the main thread waited on something.
  const threadCpu = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage : null;
  let mainCpu = threadCpu ? threadCpu() : null;

  // A CPU profile names the functions of a stall (stall-profile.js): in every build it turns on
  // after a stall, so the next ones of a cluster are named; TNAI_STALL_PROFILE=1 keeps it on the
  // whole time, "0" off.
  const profile = require('./stall-profile').start(dir, every, ran);
  const flush = () => {
    if (writing || !pending) return;
    writing = true;
    const text = pending;
    pending = '';
    fs.promises
      .stat(file)
      .then(st =>
        st.size > MAX_BYTES ? fs.promises.rename(file, path.join(dir, 'stalls.old.log')) : null
      )
      .catch(() => {})
      .then(() => fs.promises.appendFile(file, text))
      .catch(() => {})
      .finally(() => {
        writing = false;
        flush();
      });
  };
  every(() => {
    const now = Date.now();
    const late = now - last - TICK_MS,
      span = now - last;

    // This process's own CPU time (all its threads, user + system) since the last tick: near the
    // blocked time means our code ran that long; far below it means the process was not running (a
    // starved or sleeping PC, a wait on the disk or on another process).
    const used = process.cpuUsage(cpu);
    cpu = process.cpuUsage();
    const mainUsed = threadCpu ? threadCpu(mainCpu) : null;
    if (threadCpu) mainCpu = threadCpu();
    let named = '';
    if (late > STALL_MS) {
      const head =
        `[tnai stall] main process blocked ~${late} ms at ${new Date(now).toISOString()}` +
        (busy ? ` · longest named section: ${busy.name} ${busy.ms} ms` : ' · no named section') +
        ` · own CPU ${Math.round((used.user + used.system) / 1000)} ms of ${span} ms` +
        (mainUsed
          ? ` · main thread CPU ${Math.round((mainUsed.user + mainUsed.system) / 1000)} ms`
          : '') +
        ` · in callbacks ${Math.round(inCallbacks)} ms` +
        (accessibilityOn() ? ' · accessibility on' : '');

      // read at once, before newer samples bury the stretch
      named = profile ? profile.explain(late) : '';

      // Node hands over its record of a pause one step later in the same turn of the loop, so the
      // line is written there.
      setImmediate(() => {
        const gc = gcSince();

        // How full the heap is: a stall with no named section and a heap near its limit points at
        // garbage collection, a small heap at a wait on the disk or another process. Read only when
        // a stall is written.
        let heap = '';
        try {
          const { heapUsed, heapTotal } = process.memoryUsage();
          heap = ` · heap ${Math.round(heapUsed / 1048576)} of ${Math.round(heapTotal / 1048576)} MB`;
        } catch {}
        const line =
          head +
          (gc.total >= 20
            ? ` · garbage collection ${gc.total} ms (longest pause ${gc.longest} ms)`
            : '') +
          heap +
          (named ? '\n' + named : '');
        console.warn(line);
        if (file) {
          pending += line + '\n';
          flush();
        }
      });
    } else gcSince(); // pauses of a turn that was not late are not kept for a later line

    // reading the profile (or turning it on) took time of this tick: the next tick counts from
    // its end
    last = late > STALL_MS ? Date.now() : now;
    busy = null;
    inCallbacks = 0;
  }, TICK_MS).unref();
}

module.exports = { start, ran, timed, sections, gcSince };
