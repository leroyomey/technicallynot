/*
 * Technically Not tools · desktop-check/tests/needs-decision.js — An agent waiting on a "- Decide:"
 * question (51 deciding, stood in here on a real PowerShell thread; nothing is sent to an agent):
 * its row in the thread list takes the needs-you tone, the agent card that 11 keeps says "Needs
 * your decision · <question>" and holds the options, a click sends the choice (49 decide,
 * stubbed), the "N need you" chip, the window title and Ctrl+Shift+J count it. Returns {ok, log}.
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
  const card = await until(() => document.querySelector('.tnai-card[data-pane="' + paneId + '"]'));
  const chip = document.querySelector('.tnai-needs-chip');
  check(
    !!card && !!chip && chip.hidden && card.querySelector('.tnai-card-decide').hidden,
    'before: no decision box on the card, no "need you" chip'
  );

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
  const pill = await until(
    () =>
      card.querySelector('.c-status').textContent === 'Needs your decision' &&
      card.querySelector('.c-status')
  );
  check(
    !!pill && card.hasAttribute('data-needs-you'),
    'card status pill: "' + card.querySelector('.c-status').textContent + '"'
  );
  check(
    /Needs your decision · Which router\?/.test(card.querySelector('.c-now').textContent),
    'card Now line: "' + card.querySelector('.c-now').textContent + '"'
  );
  const box = card.querySelector('.tnai-card-decide'),
    opts = [...box.querySelectorAll('[data-act="decide"]')];
  check(
    !box.hidden &&
      /Which router\?/.test(box.querySelector('.c-decide').textContent) &&
      opts.length === 2 &&
      opts[0].textContent === 'Hash router' &&
      !!opts[1].querySelector('.tnai-rec'),
    'card: the question and both options, the recommended one tagged'
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

  const onOverview = location.hash,
    viewBefore = document.querySelector('.layout')?.className;
  opts[1].click();
  await wait(100);
  check(
    sent.length === 1 && sent[0][0] === 'test-entry' && sent[0][1] === '1' && sent[0][2] === 'send',
    'click an option → the choice is sent (' + JSON.stringify(sent[0]) + ')'
  );
  check(
    document.querySelector('.layout')?.className === viewBefore && location.hash === onOverview,
    'clicking an option does not open the Agents page'
  );

  N.deciding = real.deciding;
  A.repaint();
  check(
    !!(await until(
      () =>
        box.hidden &&
        chip.hidden &&
        !/Needs your decision/.test(card.querySelector('.c-status').textContent) &&
        !/^\(\d+\) /.test(document.title)
    )),
    'answered: box, chip and title count go away'
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
