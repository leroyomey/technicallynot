// Technically Not tools · desktop-check/tests/resize-smooth.js — a terminal follows a drag as it
// happens, and never shows an empty frame on the way. It runs with the app's real drawing (the
// GPU renderer; most tests use the other one), because the fault it guards is in that drawing.
//
// Two real PowerShell threads print some text. Then:
//   1. The cause of the flicker, tested straight: a terminal's size is changed, and in the same
//      step, before the window can show anything, its canvas is read. It must already hold the
//      text. (Before the fix the canvas was empty there until the next frame: the flash the user
//      saw at every step of a drag.)
//   2. The window's edge is dragged in and out, a step every 16 ms, with a thread open on its CLI
//      screen: the terminal changes its columns during the drag, not only after it, it fills
//      its box when the drag is over, and each session was told a few sizes, not one per step.
// Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
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
const threads = window.TnaiThreads;

// The GPU renderer of a terminal, or null when it draws the other way.
const rendererOf = term => {
  const renderer = term?._core?._renderService?._renderer?.value;
  return renderer?._gl && renderer._canvas ? renderer : null;
};

// How many points of the top of a terminal's canvas hold something drawn, read now (not after a
// frame).
function drawnPoints(renderer) {
  const gl = renderer._gl;
  const width = Math.min(gl.drawingBufferWidth, 900);
  const height = Math.min(gl.drawingBufferHeight, 300);
  const pixels = new Uint8Array(width * height * 4);

  // the buffer's first row is its bottom one
  gl.readPixels(
    0,
    gl.drawingBufferHeight - height,
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels
  );
  let drawn = 0;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) drawn++;
  return drawn;
}

// The terminals on screen now, with a counter of their size changes.
const watched = new Map();

function watchShown() {
  for (const view of agents.views()) {
    const term = view.term;
    if (!term?.element || watched.has(term)) continue;
    const entry = { where: view.where, changes: 0 };
    term.onResize(() => entry.changes++);
    watched.set(term, entry);
  }
}

// on screen: its box has a size (a view kept for later is parked in a box of no size)
const shownNow = () =>
  [...watched].filter(([term]) => term.element?.parentElement?.getBoundingClientRect().width > 0);
const reset = () => watched.forEach(entry => (entry.changes = 0));
const counts = () => shownNow().map(([, entry]) => entry.changes);

async function dragBothWays(label) {
  watchShown();
  await main('takeResizes');
  for (const [from, to] of [
    [1440, 1100],
    [1100, 1440],
  ]) {
    reset();
    await main('drag', from, 900, to, 900, 60);
    const during = counts();
    check(
      during.length > 0 && during.every(count => count >= 5),
      label +
        ', ' +
        from +
        ' to ' +
        to +
        ': each terminal followed the drag while it ran (its size changed ' +
        during.join(', ') +
        ' times in 60 steps)'
    );
    await wait(900);
    const fitted = shownNow().every(([term]) => {
      const screen = term.element.querySelector('.xterm-screen').getBoundingClientRect();
      const box = term.element.parentElement.getBoundingClientRect();
      return screen.width <= box.width + 1 && screen.width > box.width - 40;
    });
    check(fitted, label + ', ' + from + ' to ' + to + ': each terminal fills its box afterwards');
  }
  const sent = await main('takeResizes');
  check(
    sent.every(count => count <= 8),
    label +
      ': each session was told a few sizes for the two drags, not one per step (' +
      sent.join(', ') +
      ')'
  );
}

// A session is started the way a user starts one: as a thread. Answers as the old start
// call did: { ok, paneId } or { ok: false, error }.
const openThread = async (tool, options = {}) => {
  try {
    const made = await window.TnaiTest.startThread({ tool, ...options });
    return { ok: true, paneId: made.paneId };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
};
try {
  await until(() => threads?.visible(), 8000);
  await agents.detect(true);
  for (let count = 0; count < 2; count++) await openThread('Terminal');
  check(
    !!(await until(() => agents.sessions().filter(s => s.running).length >= 2, 30000)),
    'setup: two PowerShell sessions run'
  );
  const ids = agents.sessions().map(session => session.paneId);
  for (const id of ids)
    window.tnaiNative.pty.write(
      id,
      '1..12 | ForEach-Object { "line $_ of some text to draw " * 3 }\r'
    );
  await main('size', 1440, 900);
  await wait(1500);

  // ---- 1. the canvas holds the text in the very step that changed its size ----
  threads.open();
  await until(() => threads.visible(), 5000);
  threads.show(ids[0]);
  const term = await until(() => {
    const shown = window.TnaiThreadView.term();
    return shown?.element?.getClientRects().length ? shown : null;
  }, 8000);
  await wait(1200);
  const renderer = rendererOf(term);
  if (!renderer) {
    log.push(
      'note this window draws terminals without the GPU: the empty-canvas check was not made'
    );
  } else {
    const results = [];
    for (const change of [-3, -4, 5, 2]) {
      term.resize(term.cols + change, term.rows);
      results.push(drawnPoints(renderer));

      // let the frame pass, as between two steps of a drag
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    check(
      results.every(drawn => drawn > 200),
      'right after each of four size changes the canvas already holds the text, never an empty one (drawn points ' +
        results.join(', ') +
        ')'
    );
  }

  // ---- 2. a drag is followed as it happens ----
  await dragBothWays('thread');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
} finally {
  await main('size', 1440, 900).catch(() => {});
  agents.sessions().forEach(session => agents.stop(session.paneId));
  await until(() => !agents.sessions().some(session => session.running), 15000);
}
return { ok, log };
