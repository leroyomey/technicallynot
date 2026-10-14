// Technically Not tools · desktop-check/tests/all-threads-step-speed.js — how fast one step is on
// the All threads page (135) with twelve threads open. Twelve PowerShell threads (the panel
// limit; nothing is sent to them); the page is stepped forward and back with its arrows, ROUNDS
// times. Measured per step, the way perf-page-switch measures a page: the time the press itself
// takes, the time from the press to the next frame, the longest task while stepping, and the
// longest gap between two frames. A step moves the row with a transform, so the limit is one that
// a slide can keep: STEP_LIMIT_MS from the press to the next frame (the middle step and the
// slowest one are both reported; the middle one is checked).
// A window that is covered draws no frames: a frame time over a second, or no frames at all, means
// the window was not drawn, not that the page is slow; the test says so. Returns {ok, log}.
const THREADS = 12;
const ROUNDS = 30;
const STEP_LIMIT_MS = 50;
const LONG_TASK_LIMIT_MS = 100;

const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};

// The next frame. A covered window draws none: after a second the wait is given up, and the
// numbers then say that the window was not drawn.
const frame = () =>
  new Promise(resolve => {
    const giveUp = setTimeout(resolve, 1000);
    requestAnimationFrame(() => {
      clearTimeout(giveUp);
      resolve();
    });
  });
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents;
const all = () => window.TnaiAllThreads;
const middle = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const most = list => Math.max(0, ...list);
const one = value => Math.round(value * 10) / 10;
const opened = [];

try {
  await main('size', 1920, 1000);
  await agents.detect(true);
  for (let count = 0; count < THREADS; count++) {
    if (agents.sessions().filter(s => s.running).length >= THREADS) break;
    const made = await window.TnaiTest.startThread({ tool: 'Terminal' });
    opened.push(made.paneId);
  }
  await window.TnaiTest.openAllThreads();
  const view = document.getElementById('terminalView');
  const on = await until(() => all()?.state().on && all().state().order.length >= THREADS, 15000);
  check(
    !!on,
    'setup: ' +
      all()?.state().order.length +
      ' threads on the page, ' +
      all()?.state().per +
      ' in sight'
  );
  const next = view.querySelector('.tat-next');
  const previous = view.querySelector('.tat-prev');

  // One measured run of ROUNDS steps, forward to the end of the row and back.
  async function measure(label) {
    all().show(all().state().order[0]);
    await wait(1200);
    const inSight = all().state().per;
    const longTasks = [];
    const observer = new PerformanceObserver(list =>
      list.getEntries().forEach(entry => longTasks.push(entry.duration))
    );
    observer.observe({ type: 'longtask' });
    const frames = [];
    let watching = true;
    const tick = time => {
      frames.push(time);
      if (watching) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const pressTimes = [];
    const frameTimes = [];
    let moved = 0;
    for (let round = 0; round < ROUNDS; round++) {
      // every step is a real one: the direction turns at each end of the row
      const forward = Math.floor(round / (THREADS - inSight)) % 2 === 0;
      const button = forward ? next : previous;
      const before = all().state().first;
      await frame();
      const start = performance.now();
      button.click();
      pressTimes.push(performance.now() - start);
      await frame();
      frameTimes.push(performance.now() - start);
      if (all().state().first !== before) moved++;

      // the slide is over before the next press, as when a person steps through
      await wait(220);
    }
    watching = false;
    observer.disconnect();
    await wait(100);
    const gaps = [];
    for (let index = 1; index < frames.length; index++)
      gaps.push(frames[index] - frames[index - 1]);

    const drawn = frames.length > ROUNDS * 5 && most(frameTimes) < 1000;
    log.push(
      'time ' +
        label +
        ' (' +
        inSight +
        ' in sight): a step, press to next frame: middle ' +
        one(middle(frameTimes)) +
        ' ms, slowest ' +
        one(most(frameTimes)) +
        ' ms; the press itself: middle ' +
        one(middle(pressTimes)) +
        ' ms, slowest ' +
        one(most(pressTimes)) +
        ' ms; longest task: ' +
        one(most(longTasks)) +
        ' ms (' +
        longTasks.length +
        ' over 50 ms); longest gap between two frames: ' +
        one(most(gaps)) +
        ' ms, ' +
        gaps.filter(gap => gap > 50).length +
        ' of ' +
        gaps.length +
        ' over 50 ms'
    );
    check(drawn, label + ': the window was drawn while measuring (' + frames.length + ' frames)');
    check(
      moved >= ROUNDS - 2,
      label + ': the steps moved the row (' + moved + ' of ' + ROUNDS + ')'
    );
    check(
      middle(frameTimes) <= STEP_LIMIT_MS,
      label +
        ': a step is on screen within ' +
        STEP_LIMIT_MS +
        ' ms (middle ' +
        one(middle(frameTimes)) +
        ' ms)'
    );
    check(
      most(longTasks) <= LONG_TASK_LIMIT_MS,
      label +
        ': no task while stepping is longer than ' +
        LONG_TASK_LIMIT_MS +
        ' ms (' +
        one(most(longTasks)) +
        ' ms)'
    );
  }

  // as the page opens (Live preview beside the threads), then with the preview put away, where
  // more threads stand side by side and a step brings a new one into sight among them
  await measure('with Live preview');
  const wasOpen = window.TnaiTerminalPreview.previewOpen();
  window.TnaiTerminalPreview.setPreview(false);
  await wait(600);
  await measure('preview put away');
  window.TnaiTerminalPreview.setPreview(wasOpen);
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
for (const paneId of opened) await agents.stop(paneId).catch(() => {});

// twelve shells end before the window goes (the app closed badly when it was closed at once)
await wait(2500);
await main('size', 1440, 900).catch(() => {});
return { ok, log };
