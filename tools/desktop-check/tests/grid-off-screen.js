/*
 * Technically Not tools · desktop-check/tests/grid-off-screen.js — The old Overview's agent grid
 * of 11-agents-live.js is never on screen in the thread design, so it builds no cards (speed lead
 * 8 in docs/notes/speed-numbers.md), not even for a thread that takes the empty panel the app
 * started with; the header line it keeps outside the grid still counts the agent; and its
 * render queue leaves no animation frame waiting once a render ran (a minimized window runs no
 * frames, so each queued render left one behind). One real PowerShell thread, nothing sent to an
 * agent. Returns {ok, log}.
 */
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
    await wait(50);
  }
  return null;
};

const agents = window.TnaiAgents;
const layout = document.querySelector('.layout');
const realFrame = window.requestAnimationFrame;
const realCancel = window.cancelAnimationFrame;
try {
  const paneId = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  check(
    !!(await until(() => agents.sessions().find(s => s.paneId === paneId && s.running))),
    'a PowerShell thread started'
  );
  await wait(800);
  check(
    !document.querySelector('.tnai-live-sessions .tnai-card'),
    'the hidden old grid has no cards: ' +
      document.querySelectorAll('.tnai-live-sessions .tnai-card').length
  );
  const status = document.querySelector('.top-right .status')?.textContent || '';
  check(
    /1 agent running|No agents running/.test(status),
    'the header line outside the grid is still written: "' + status + '"'
  );

  // A window that draws no frames (minimized): frames are held, never run. Each class change of
  // the layout queues one render of 11 (its own observer); its timer runs the render, and the
  // frame it also asked for must be cancelled then, not left waiting.
  const waiting = new Map();
  let next = 0;
  window.requestAnimationFrame = callback => {
    next++;
    waiting.set(next, callback);
    return next;
  };
  window.cancelAnimationFrame = id => waiting.delete(id);
  const fromGrid = () =>
    [...waiting.values()].filter(callback => /queued = 0;\s*render\(\)/.test(String(callback)))
      .length;
  for (let round = 0; round < 12; round++) {
    layout.classList.toggle('tnai-test-grid-tick');
    await wait(160);
  }
  layout.classList.remove('tnai-test-grid-tick');
  await wait(160);
  check(
    fromGrid() <= 1,
    'frames the grid left waiting after 12 renders with no frames drawn: ' + fromGrid()
  );
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
} finally {
  window.requestAnimationFrame = realFrame;
  window.cancelAnimationFrame = realCancel;
}
agents
  .sessions()
  .filter(s => s.running)
  .forEach(s => agents.stop(s.paneId));
await until(() => !agents.sessions().some(s => s.running), 5000);
return { ok, log };
