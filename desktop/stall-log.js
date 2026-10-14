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
          inner = 0;
          try {
            return fn.apply(this, args);
          } finally {
            const ms = performance.now() - t;
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

function start(dir) {
  const file = dir ? path.join(dir, 'stalls.log') : '';
  const every = setInterval; // the stall timer itself is not one of the named timers
  nameTimers();
  watchGc();
  let last = Date.now(),
    writing = false,
    pending = '',
    cpu = process.cpuUsage();
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
    if (late > STALL_MS) {
      const head =
        `[tnai stall] main process blocked ~${late} ms at ${new Date(now).toISOString()}` +
        (busy ? ` · longest named section: ${busy.name} ${busy.ms} ms` : ' · no named section') +
        ` · own CPU ${Math.round((used.user + used.system) / 1000)} ms of ${span} ms`;

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
          heap;
        console.warn(line);
        if (file) {
          pending += line + '\n';
          flush();
        }
      });
    } else gcSince(); // pauses of a turn that was not late are not kept for a later line
    last = now;
    busy = null;
  }, TICK_MS).unref();
}

module.exports = { start, ran, timed, sections, gcSince };
