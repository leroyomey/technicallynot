// Technically Not · stall-profile.js — Names the code behind a main-process stall that
// stall-log.js cannot name (work after an `await`, Electron's own work). Only when the app is
// started with TNAI_STALL_PROFILE=1 (a dev run, `npm start`): the main process is CPU-profiled the
// whole time, and when stall-log.js sees a stall the profile is read for the busy stretch just
// before it and one line names its kinds of work and its functions. The profile is saved to
// stall-profiles\ in the settings folder (the newest few kept) to open in DevTools. Off, nothing
// here runs. The desktop test main-stalls-profile reads its own profile with busyStretches.
'use strict';
const fs = require('fs');
const path = require('path');

// Shortest busy stretch that counts (stall-log.js writes a line from 100 ms late).
const BUSY_MS = 80;

// Sampling interval in microseconds: fine enough to name a 100 ms stretch.
const SAMPLE_US = 1000;

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

// Starts the profiler when TNAI_STALL_PROFILE=1; returns null otherwise. `dir` is the settings
// folder. The result's `explain(lateMs)` stops the profile, returns one line about the busy
// stretch that ended last (or '' when none was found), saves the profile and starts a new one.
function start(dir, timer = setInterval, ran = () => {}) {
  if (process.env.TNAI_STALL_PROFILE !== '1') return null;
  const inspector = require('inspector');
  const session = new inspector.Session();
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
  const begin = () => {
    call('Profiler.setSamplingInterval', { interval: SAMPLE_US });
    call('Profiler.start');
    startedAt = Date.now();
  };
  const end = () => call('Profiler.stop').profile;
  const folder = dir ? path.join(dir, 'stall-profiles') : '';
  const save = profile => {
    if (!folder) return;
    const text = JSON.stringify(profile);
    fs.promises
      .mkdir(folder, { recursive: true })
      .then(() =>
        fs.promises.writeFile(path.join(folder, 'main-' + startedAt + '.cpuprofile'), text)
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
  try {
    session.connect();
    call('Profiler.enable');
    begin();
  } catch (error) {
    console.warn('[tnai] stall profile could not start:', error?.message || error);
    return null;
  }

  // a new profile every ROTATE_MS, without saving the old one (nothing stalled in it)
  // (named, so the rotation's own short block is never taken for an unnamed stall)
  timer(() => {
    const before = performance.now();
    try {
      end();
      begin();
    } catch {}
    ran('stall profile rotation', performance.now() - before);
  }, ROTATE_MS).unref();

  return {
    explain(lateMs) {
      try {
        const profile = end();
        const profiledFrom = startedAt;
        begin();
        save(profile);
        const found = busyStretches(profile, profiledFrom, Math.min(BUSY_MS, lateMs)).stretches;

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
