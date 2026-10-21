/*
 * Technically Not tools · desktop-check/tests/thread-stream-leak.js — Does the window keep memory
 * after threads that streamed output are closed? ROUNDS (TNAI_LEAK_ROUNDS, default 5) of: start
 * THREADS (TNAI_LEAK_THREADS, default 10) PowerShell threads, run a small output printer in each
 * (about 40 KB of Claude-Code-like lines, then it exits) while one simulated Claude Code task per
 * thread plays over the real hook server, show every thread on the Threads page while it streams,
 * its CLI screen and back, open All threads, then close every thread. The window is minimized for
 * the whole run (TNAI_LEAK_HIDDEN=0 keeps it in front): a minimized window draws no frames, and
 * that is where closed threads were kept. Heap snapshots of the window after round 1 (the
 * warm-up), after the middle round and after the last are compared by kind of object: one of the
 * app's own kinds that grows in both halves by 25 or more objects per closed thread fails the
 * test, as does growth of the heap, page elements or listeners past the limits per closed thread.
 * It prints what still keeps closed terminals (their paths from the heap's root) and the frame
 * callbacks still waiting. Found 2026-10-15: every thread closed while the window was minimized
 * kept its terminals (~265 KB, ~250 page elements, ~37 listeners each) until the window was shown
 * again. No agent CLI, no prompt to a model, one printer per thread at a time.
 */
const ANSI_CODES = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[ -\\/]*[@-~]', 'g');

// Growth allowed per closed thread, from the end of the warm-up round to the end of the last. The
// old code kept about 265 KB, 250 page elements and 37 listeners per closed thread; what is left
// (about 30 KB and 15 to 30 elements) is the browser's own: CSS animations of removed elements,
// which it lets go at the next drawn frame.
const LIMIT_PER_THREAD = { heapMB: 0.1, nodes: 60, listeners: 3, mainHeapMB: 0.2 };

const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (condition, label) => {
  log.push((condition ? 'ok   ' : 'FAIL ') + label);
  if (!condition) ok = false;
};
const until = async (test, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    await wait(100);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = reply => {
      delete window.__tnaiMainDone[id];
      reply?.ok ? resolve(reply.value) : reject(new Error(reply?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents;

const describe = sample =>
  'renderer heap ' +
  sample.heapMB +
  ' MB · nodes ' +
  sample.nodes +
  ' · listeners ' +
  sample.listeners +
  ' · main heap ' +
  sample.mainHeapMB +
  ' MB rss ' +
  sample.mainRssMB +
  ' MB · children ' +
  sample.children;
const describeGrowth = rows =>
  rows.map(
    ([kind, count, bytes]) => kind + ' +' + count + ' (' + Math.round(bytes / 1024) + ' KB)'
  );

// The app's own objects, closures, arrays and page elements; not the engine's compiled code,
// shapes, strings and numbers, which grow while code warms up, and not the browser's timeline
// entries (layout shifts, long frames), which it keeps in buffers of its own size.
const isAppKind = kind =>
  /^(object|closure|array|native):/.test(kind) &&
  !/^native:(system|Performance|LayoutShift|TaskAttribution|DOMRectReadOnly|blink::|CSSAnimation|CSSTransition|KeyframeEffect)/.test(
    kind
  ) &&
  !/^object:system /.test(kind);

// A shell's first prompt, read from its record: a command sent before it is lost.
const promptShown = record => {
  const text = String(record?.buffer || '').replace(ANSI_CODES, '');
  return />\s*$|[$#]\s*$/.test(text);
};
const replays = ids => Promise.all(ids.map(id => window.tnaiNative.pty.replay(id)));

const open = new Set();
try {
  const rounds = await main('rounds');
  const threadCount = await main('threads');
  const printer = await main('printer');
  const middle = Math.ceil((rounds + 1) / 2);
  const samples = {};
  const startedAt = performance.now();
  window.TnaiThreads.open();
  await wait(500);

  // The whole run with the window minimized, as when the user works in another program while
  // agents run (TNAI_LEAK_HIDDEN=0 keeps it in front).
  const hidden = await main('hidden');
  if (hidden) {
    await main('minimize');
    await until(() => document.visibilityState === 'hidden', 5000);
    log.push('info window minimized for the whole run (page ' + document.visibilityState + ')');
  }

  for (let round = 1; round <= rounds; round++) {
    await main('progress', 'round ' + round + '/' + rounds + ': start ' + threadCount + ' threads');
    const ids = [];
    for (let k = 0; k < threadCount; k++) {
      const made = await window.TnaiTest.startThread({ tool: 'Terminal' });
      ids.push(made.paneId);
      open.add(made.paneId);
    }
    await until(async () => (await replays(ids)).every(promptShown), 20000);
    await wait(300);

    // Every thread streams while it is shown on the Threads page, one after another.
    ids.forEach(id => agents.send(id, "node '" + printer + "' 300"));
    const tasks = Promise.all(ids.map(id => main('turn', id, round)));
    for (const id of ids) {
      window.TnaiThreads.show(id);
      await wait(120);
    }

    // The CLI screen of one thread, and back to its conversation.
    window.TnaiThreads.show(ids[0]);
    window.TnaiThreadView.setMode('term');
    await wait(300);
    window.TnaiThreadView.setMode('read');
    await tasks;
    await until(
      async () => (await replays(ids)).every(record => /Done/.test(record?.buffer || '')),
      15000
    );
    await window.TnaiTest.openAllThreads();
    await wait(300);
    window.TnaiThreads.open();
    await wait(200);

    // Closed the way the app closes a thread: the Close button of its panel underneath.
    await main('progress', 'round ' + round + '/' + rounds + ': close the threads');
    for (const id of ids) {
      document
        .querySelector(
          '.terminal-pane[data-pane-id="' +
            CSS.escape(id) +
            '"] .terminal-pane-tools button[title="Close terminal"]'
        )
        ?.click();
      open.delete(id);
    }
    await until(
      () =>
        !ids.some(id =>
          document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(id) + '"]')
        ) && !agents.sessions().some(session => ids.includes(session.paneId) && session.running),
      15000
    );

    // Let exits, saves and fades settle before a reading.
    await wait(2500);
    if (round === 1 || round === middle || round === rounds) {
      const name = round === 1 ? 'start' : round === rounds ? 'end' : 'middle';
      samples[name] = await main('sample');
      await main('snapshot', name);
      log.push('info after round ' + round + ' (' + name + '): ' + describe(samples[name]));
    }
  }

  // Growth from the end of the warm-up round to the end of the last.
  const closedAfterWarmUp = (rounds - 1) * threadCount;
  const firstHalf = (middle - 1) * threadCount;
  const secondHalf = (rounds - middle) * threadCount;
  const whole = await main('diff', 'start', 'end', Math.ceil(closedAfterWarmUp / 2));
  log.push(
    'info ' +
      Math.round((performance.now() - startedAt) / 1000) +
      ' s, ' +
      rounds * threadCount +
      ' threads opened, streamed into and closed'
  );
  log.push(
    'info heap growth by kind from round 1 to round ' +
      rounds +
      ': ' +
      (describeGrowth(whole).join(' | ') || 'none')
  );

  // Kept by closed threads: one of the app's own kinds of object (not the engine's compiled code,
  // strings or numbers, nor the browser's animations) that grows in both halves by PER_KIND or more
  // objects per closed thread. A kept terminal grew plain objects by about 600 a thread; about 10
  // a thread is the browser's stale layout of removed elements, let go at the next drawn frame.
  const PER_KIND = 25;
  const early = await main('diff', 'start', 'middle', firstHalf * PER_KIND);
  const late = await main('diff', 'middle', 'end', secondHalf * PER_KIND);
  const lateKinds = new Set(late.filter(row => row[1] >= secondHalf * PER_KIND).map(row => row[0]));
  const steady = early.filter(
    ([kind, count]) => count >= firstHalf * PER_KIND && lateKinds.has(kind) && isAppKind(kind)
  );
  check(
    steady.length === 0,
    'no kind of object grows by ' +
      PER_KIND +
      ' or more per closed thread in both halves' +
      (steady.length ? ': ' + describeGrowth(steady).join(' | ') : '')
  );

  // The frame callbacks still waiting (a minimized window runs none), and what keeps any terminal
  // made during the run alive: for each terminal's screen element (only a terminal has one), its
  // path from the heap's root, counted by path.
  const frames = await main('pendingFrames', 'end');
  log.push(
    'info frame callbacks waiting at the end: ' +
      (frames.map(([place, count]) => count + '× ' + place).join(' | ') || 'none')
  );
  const kept = await main('rootsOf', 'start', 'end', 'native:<div class="xterm-screen"');
  for (const [path, count] of kept.paths) log.push('info ' + count + ' terminals kept by: ' + path);
  for (const [kind] of steady.slice(0, 2)) {
    const held = await main('rootsOf', 'start', 'end', kind);
    for (const [path, count] of held.paths.slice(0, 3))
      log.push('info ' + count + ' ' + kind + ' kept by: ' + path);
  }
  for (const key of Object.keys(LIMIT_PER_THREAD)) {
    const growth = Math.round((samples.end[key] - samples.start[key]) * 10) / 10;
    const limit = Math.round(LIMIT_PER_THREAD[key] * closedAfterWarmUp * 10) / 10;
    check(
      growth <= limit,
      key +
        ' growth over ' +
        closedAfterWarmUp +
        ' closed threads: ' +
        growth +
        ' (≤ ' +
        limit +
        '; ' +
        Math.round((growth / closedAfterWarmUp) * 1000) / 1000 +
        ' per thread)'
    );
  }
  if (hidden) {
    await main('restore');
    await wait(2500);
    log.push('info after the window is restored: ' + describe(await main('sample')));
  }
  check(
    samples.end.children <= samples.start.children,
    'no child process outlives its thread (' +
      samples.start.children +
      ' → ' +
      samples.end.children +
      ')'
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
for (const id of open) {
  try {
    agents.stop(id);
  } catch {}
}
await main('cleanup').catch(() => {});
return { ok, log };
