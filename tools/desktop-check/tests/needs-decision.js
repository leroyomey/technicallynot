/*
 * Technically Not tools · desktop-check/tests/needs-decision.js — An agent waiting on a "- Decide:"
 * question (51 deciding, stood in here on a real PowerShell thread; nothing is sent to an agent):
 * its row in the thread list takes the needs-you tone, the "N need you" chip, the window title and
 * Ctrl+Shift+J count it, and the hidden old grid of 11 builds no card for it. Answering from the
 * thread is `decision-steps`. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};

const N = window.TnaiNextActions,
  C = window.TnaiContext,
  L = window.TnaiLiveTasks,
  A = window.TnaiAgents;
const real = { deciding: N?.deciding, decide: C?.decide, focusPane: L?.focusPane };
try {
  check(
    !!(N && C && window.TnaiNeedsYou),
    'next actions, project context and Needs you are loaded'
  );
  const paneId = (await window.TnaiTest.startThread({ tool: 'Terminal', show: true })).paneId;
  check(
    !!(await until(() => A.sessions().find(s => s.paneId === paneId && s.running))),
    'shell started as a thread'
  );
  await wait(1500);
  const threadRow = () => window.TnaiThreadList.rows().find(row => row.paneId === paneId);
  check(
    !!(await until(() => threadRow() && threadRow().tone !== 'needs', 5000)),
    'before: the thread row does not say it needs the user (tone ' + threadRow()?.tone + ')'
  );
  const chip = document.querySelector('.tnai-needs-chip');
  check(!!chip && chip.hidden, 'before: no "need you" chip');

  const sent = [],
    jumped = [];
  N.deciding = p =>
    p === paneId
      ? {
          id: 'test-entry',
          question: 'Which router?',
          options: [{ label: 'Hash router' }, { label: 'History router', recommended: true }],
        }
      : null;
  C.decide = (...args) => {
    sent.push(args);
    return true;
  };
  if (L) L.focusPane = p => jumped.push(p);
  A.repaint();

  // (The old Overview card of 11 that held the options is no longer built; the thread answers a
  // decision on its own, tested by `decision-steps`.)
  check(
    !document.querySelector('.tnai-card[data-pane="' + paneId + '"]'),
    'the hidden old grid builds no card for it'
  );

  // What the user sees of it on the Threads page: the thread row takes the "needs you" tone.
  window.TnaiThreadList.refresh();
  check(
    !!(await until(() => threadRow()?.tone === 'needs', 5000)),
    'the thread row in the thread list has the needs-you tone (' + threadRow()?.tone + ')'
  );
  check(
    !!(await until(() => !chip.hidden && chip.textContent.trim() === '1 needs you')),
    'chip counts the decision: "' + chip.textContent.trim() + '"'
  );
  check(/^\(1\) /.test(document.title), 'window title counts it: "' + document.title + '"');
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'J',
      code: 'KeyJ',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    })
  );
  check(jumped[0] === paneId || !L, 'Ctrl+Shift+J goes to the deciding agent');
  jumped.length = 0;
  chip.click();
  check(jumped[0] === paneId || !L, 'the chip goes to it too');
  console.log('TNAI_SHOT:needs-decision-card');
  await wait(600);
  check(sent.length === 0, 'nothing was sent to the agent along the way');

  N.deciding = real.deciding;
  A.repaint();
  check(
    !!(await until(() => chip.hidden && !/^\(\d+\) /.test(document.title))),
    'answered: chip and title count go away'
  );
} catch (e) {
  check(false, 'error: ' + (e?.stack || e));
} finally {
  if (N) N.deciding = real.deciding;
  if (C) C.decide = real.decide;
  if (L) L.focusPane = real.focusPane;
}
const shell = window.TnaiAgents.sessions().find(s => s.running);
if (shell) {
  window.TnaiAgents.stop(shell.paneId);
  await wait(300);
}
return { ok, log };
