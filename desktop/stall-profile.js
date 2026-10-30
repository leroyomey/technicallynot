// Technically Not · stall-profile.js — Names the code behind a main-process stall that
// stall-log.js cannot name (work after an `await`, Electron's own work). While the main process
// is CPU-profiled, a stall seen by stall-log.js reads the profile for the busy stretch just before
// it, and one line names its kinds of work and its functions. The profile is saved to
// stall-profiles\ in the settings folder (the newest few kept) to open in DevTools. The desktop
// test main-stalls-profile reads its own profile with busyStretches.
//
// When the profile runs (TNAI_STALL_PROFILE):
// - "1" (a dev run, `npm start`): the whole time, sampled every 1 ms.
// - "0": never; nothing here runs.
// - not set (every installed build): off until a stall, then on for AFTER_STALL_MS, at most
//   WINDOWS_MAX times per app run. The stall that turns it on gets no profile line; the ones after
//   it do. Stalls come in clusters (2026-10-29: in the installed log, 131 of the 183 stalls that
//   used the CPU came within 20 minutes of another one), so most name themselves; the dev mode
//   needed someone to run it and was never run with real agents.
'use strict';
const fs = require('fs');
const path = require('path');

// Shortest busy stretch that counts (stall-log.js writes a line from 100 ms late).
const BUSY_MS = 80;

// Sampling interval in microseconds: fine enough to name a 100 ms stretch. After a stall it is
// 2 ms: measured 2026-10-29 in Electron's main process under a light load, the profile cost about
// 0.5% of the main thread and 1.8 to 2.7% of one core at 2 ms (1.0 to 1.8% and 3.2 to 4.7% at 1
// ms).
const SAMPLE_US = 1000;
const AFTER_STALL_SAMPLE_US = 2000;

// How long the profile stays on after a stall, and how many times a run turns it on (two hours
// in all at most).
const AFTER_STALL_MS = 20 * 60 * 1000;
const WINDOWS_MAX = 6;

// A profile is started anew this often, so it never grows without end. Stopping one is a block of
// its own (the inspector hands the whole profile over): 81 ms for 2 minutes of samples in the app
// (2026-10-21), so the profiles are kept short.
const ROTATE_MS = 30 * 1000;

// Saved profiles kept in the folder.
const KEEP = 5;

// Runs of non-idle samples of `minimum` ms or more, each with its time, its kinds of work (JS,
// "(program)" = Electron's or V8's own native work, garbage collection), the functions that ran
// most, the outermost frames they ran under and the stack of its most common sample.
function busyStretches(cpu, startedAt, minimum = BUSY_MS) {
  const byId = new Map(cpu.nodes.map(node => [node.id, node]));
  const parent = new Map();
  for (const node of cpu.nodes) {
    for (const child of node.children || []) parent.set(child, node.id);
  }
  const frameName = callFrame =>
    (callFrame.functionName || '(anon)') +
    (callFrame.url
      ? ' ' + callFrame.url.split(/[\\/]/).pop() + ':' + (callFrame.lineNumber + 1)
      : '');
  const isIdle = id => byId.get(id).callFrame.functionName === '(idle)';

  // Sample i starts at times[i] and lasts until times[i + 1].
  const times = [];
  let clock = cpu.startTime;
  cpu.timeDeltas.forEach(delta => times.push((clock += delta)));
  times.push(cpu.endTime);
  const lengthOf = index => (times[index + 1] - times[index]) / 1000;

  function describe(from, to, ms) {
    const self = new Map();
    const entry = new Map();
    const counts = new Map();
    const kinds = { js: 0, program: 0, gc: 0 };
    for (let index = from; index <= to; index++) {
      const id = cpu.samples[index];
      const length = lengthOf(index);
      const name = frameName(byId.get(id).callFrame);
      if (name === '(program)') kinds.program += length;
      else if (name === '(garbage collector)') kinds.gc += length;
      else kinds.js += length;
      self.set(name, (self.get(name) || 0) + length);
      counts.set(id, (counts.get(id) || 0) + 1);

      // the outermost frames under (root): which callback or task the work ran in
      const chain = [];
      for (let up = id; up && byId.get(up).callFrame.functionName !== '(root)'; up = parent.get(up))
        chain.unshift(frameName(byId.get(up).callFrame));
      const key = chain.slice(0, 3).join(' > ') || name;
      entry.set(key, (entry.get(key) || 0) + length);
    }
    const top = (map, count) =>
      [...map]
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([key, value]) => Math.round(value) + ' ms ' + key);
    const hottest = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const stack = [];
    for (let up = hottest; up && stack.length < 12; up = parent.get(up))
      stack.push(frameName(byId.get(up).callFrame));
    return {
      at: new Date(startedAt + (times[from] - cpu.startTime) / 1000).toISOString(),
      endsAt: startedAt + (times[to + 1] - cpu.startTime) / 1000,
      ms: Math.round(ms),
      js: Math.round(kinds.js),
      program: Math.round(kinds.program),
      gc: Math.round(kinds.gc),
      self: top(self, 6),
      entries: top(entry, 4),
      stack,
    };
  }

  const stretches = [];
  let first = -1;
  const close = last => {
    const ms = (times[last + 1] - times[first]) / 1000;
    if (ms >= minimum) stretches.push(describe(first, last, ms));
  };
  let busy = 0;
  let sampled = 0;
  for (let index = 0; index < cpu.samples.length; index++) {
    sampled += lengthOf(index);
    if (isIdle(cpu.samples[index])) {
      if (first >= 0) close(index - 1);
      first = -1;
    } else {
      busy += lengthOf(index);
      if (first < 0) first = index;
    }
  }
  if (first >= 0) close(cpu.samples.length - 1);
  return { sampledMs: Math.round(sampled), busyMs: Math.round(busy), stretches };
}

// Starts by TNAI_STALL_PROFILE (see the top of this file); returns null when it is "0", or "1"
// and the profiler cannot start. `dir` is the settings folder. The result's `explain(lateMs)` is
// called at every stall: while the profile runs, it stops it, returns one line about the busy
// stretch that ended last, saves the profile and starts a new one; while it is off (after a stall
// mode), it turns it on and returns ''.
function start(dir, timer = setInterval, ran = () => {}) {
  const mode = process.env.TNAI_STALL_PROFILE;
  if (mode === '0') return null;
  const always = mode === '1';
  const interval = always ? SAMPLE_US : AFTER_STALL_SAMPLE_US;
  let session = null;
  const call = (method, params) => {
    let answer = null;
    let failure = null;

    // a session in the same thread answers before post returns
    session.post(method, params || {}, (error, result) => {
      failure = error;
      answer = result;
    });
    if (failure) throw failure;
    return answer;
  };
  let startedAt = 0;
  let running = false;
  let rotation = null;
  let windowEndsAt = 0;
  let windows = 0;

  // the profile before the last rotation ({ profile, startedAt }): a block that ran just before a
  // rotation is in it, not in the new one
  let previous = null;
  const begin = () => {
    call('Profiler.setSamplingInterval', { interval });
    call('Profiler.start');
    startedAt = Date.now();
  };
  const end = () => call('Profiler.stop').profile;

  // A new profile every ROTATE_MS, so it never grows without end; after a stall mode, the profile
  // goes off here once its time is up. Named, so the rotation's own short block is never taken for
  // an unnamed stall.
  function rotate() {
    const before = performance.now();
    try {
      if (!always && Date.now() >= windowEndsAt) turnOff();
      else {
        previous = { profile: end(), startedAt };
        begin();
      }
    } catch {}
    ran('stall profile rotation', performance.now() - before);
  }

  function turnOn() {
    if (!session) {
      const inspector = require('inspector');
      session = new inspector.Session();
      session.connect();
      call('Profiler.enable');
    }
    begin();
    running = true;
    previous = null;
    rotation = timer(rotate, ROTATE_MS);
    rotation?.unref?.();
  }

  function turnOff() {
    clearInterval(rotation);
    rotation = null;
    running = false;
    previous = null;
    try {
      end();
    } catch {}
  }
  const folder = dir ? path.join(dir, 'stall-profiles') : '';
  const save = (profile, profiledFrom) => {
    if (!folder) return;
    const text = JSON.stringify(profile);
    fs.promises
      .mkdir(folder, { recursive: true })
      .then(() =>
        fs.promises.writeFile(path.join(folder, 'main-' + profiledFrom + '.cpuprofile'), text)
      )
      .then(() => fs.promises.readdir(folder))
      .then(names => {
        const old = names
          .filter(name => name.endsWith('.cpuprofile'))
          .sort()
          .slice(0, -KEEP);
        return Promise.all(
          old.map(name => fs.promises.rm(path.join(folder, name), { force: true }))
        );
      })
      .catch(() => {});
  };
  if (always) {
    try {
      turnOn();
    } catch (error) {
      console.warn('[tnai] stall profile could not start:', error?.message || error);
      return null;
    }
  }

  return {
    explain(lateMs) {
      if (!running) {
        // after a stall mode: this stall turns the profile on for the ones after it
        if (always || windows >= WINDOWS_MAX) return '';
        windows++;
        windowEndsAt = Date.now() + AFTER_STALL_MS;
        try {
          turnOn();
        } catch (error) {
          windows = WINDOWS_MAX;
          console.warn('[tnai] stall profile could not start:', error?.message || error);
        }
        return '';
      }
      try {
        const profile = end();
        const profiledFrom = startedAt;
        const before = previous;
        previous = null;
        begin();
        save(profile, profiledFrom);
        const minimum = Math.min(BUSY_MS, lateMs);
        let found = busyStretches(profile, profiledFrom, minimum).stretches;

        // a rotation ran between the block and this stall: the block is in the profile before it,
        // and only a stretch that ended a moment ago is this stall's
        if (!found.length && before)
          found = busyStretches(before.profile, before.startedAt, minimum).stretches.filter(
            stretch => stretch.endsAt >= Date.now() - lateMs - 1000
          );

        // the stretch that ended last: the stall timer fires right after the block
        const stretch = found.sort((a, b) => b.endsAt - a.endsAt)[0];
        if (!stretch)
          return '[tnai stall profile] no busy stretch in the profile (the process was not running)';
        return (
          `[tnai stall profile] ${stretch.ms} ms from ${stretch.at} · JS ${stretch.js} ms,` +
          ` Electron/V8 own work ${stretch.program} ms, garbage collection ${stretch.gc} ms` +
          ` · ran most: ${stretch.self.join(' | ')} · under: ${stretch.entries.join(' | ')}` +
          ` · stack: ${stretch.stack.join(' < ')}`
        );
      } catch (error) {
        return '[tnai stall profile] could not be read: ' + (error?.message || error);
      }
    },
  };
}

module.exports = { start, busyStretches };
