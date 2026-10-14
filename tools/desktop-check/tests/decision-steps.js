/*
 * Technically Not tools · desktop-check/tests/decision-steps.js — A report with several "- Decide:"
 * lines (real context store, fed by decision-steps.main.js on a real PowerShell thread; the send to
 * the agent is stood in, nothing is typed into it): every decision is kept, the one decision row on
 * the agent's card and the one section on the next-steps card step through them in order without
 * changing size, the answers go to the agent as one message that names each decision, and each
 * decision is marked answered on its own. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const N = window.TnaiNextActions,
  C = window.TnaiContext,
  A = window.TnaiAgents;
const realSend = A?.send,
  sent = [];
const marksNow = async () => (await window.tnaiNative.context.state())?.marks || {};
const REPORT = q =>
  'Compared.\n\nTechnically Not report\n- Did: compared the stores\n\n- Decide: Decision 1 of 2: ' +
  q +
  ' | 1. Disk | 2. Memory (recommended)\n\n- Decide: Decision 2 of 2: Ship it today? | 1. Yes (recommended) | 2. No';
try {
  check(
    !!(N && C && A && C.openChoice && C.decisionsOf),
    'next actions, project context and agents are loaded'
  );
  const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
  const paneId = started.paneId;
  check(!!started.session?.running, 'shell started as a thread');
  await wait(1500);
  A.send = (p, text) => {
    sent.push([p, text]);
    return true;
  };
  window.TnaiThreads.open();
  const card = await until(() => document.querySelector('.tnai-card[data-pane="' + paneId + '"]'));

  // 1. Both decisions are kept; the card's one row shows the first.
  await main('finish', paneId, 'Elm', '[TN.ai] Pick a store', REPORT('Which store?'));
  const e1 = await until(() =>
    C.entries().find(
      e => e.paneId === paneId && /Which store\?/.test(e.summary?.choices?.question || '')
    )
  );
  const all = e1 ? C.decisionsOf(e1) : [];
  check(
    all.length === 2 &&
      all[0].question === 'Decision 1 of 2: Which store?' &&
      all[1].question === 'Decision 2 of 2: Ship it today?' &&
      all[0].options[0].label === 'Memory',
    'the result keeps both decisions in order: ' + all.map(c => c.question).join(' | ')
  );
  const d1 = await until(() => N.deciding(paneId));
  check(
    d1?.id === e1?.id + '#0' && /Decision 1 of 2/.test(d1?.question || ''),
    'the waiting decision is the first: ' + d1?.id + ' "' + d1?.question + '"'
  );
  A.repaint();
  const box = card.querySelector('.tnai-card-decide'),
    q = () => box.querySelector('.c-decide').textContent,
    opts = () => [...box.querySelectorAll('[data-act="decide"]')];
  check(
    !!(await until(
      () => !box.hidden && /Decision 1 of 2: Which store\?/.test(q()) && opts().length === 2
    )),
    'card row: Decision 1 with its two options ("' + q() + '")'
  );

  // The old Overview's "waiting on you" list (.pgo-ask) is deleted. The agent's card keeps the
  // same decision row, so the stepping is read there; the thread's own buttons (.tnt-decide in the
  // Readable view) are checked by thread-readable.
  const asks = () => (box.hidden ? [] : [box]),
    ask = () => asks()[0],
    askQ = () => q(),
    askOpts = () => opts();
  check(
    !!(await until(
      () =>
        asks().length === 1 &&
        /Decision 1 of 2: Which store\?/.test(askQ()) &&
        askOpts().length === 2
    )),
    'card row: one row for this agent, Decision 1 with its two options ("' + askQ() + '")'
  );
  const sum = C.summaryFor(paneId, e1.startedAt),
    perResult = !!sum && !('brief' in sum.dataset),
    sumRows = sum?.querySelectorAll?.('.s-row[data-k="choices"]').length;
  check(
    !perResult || sumRows === 2,
    perResult
      ? 'Result summary: one Decide row per decision (' + sumRows + ')'
      : 'Result summary: not visited (it shows the standing brief here, not this result)'
  );

  // 2. Answering the first sends nothing yet and the same row moves on to the second, same size.
  askOpts()[0].click();
  check(
    !!(await until(
      () =>
        /Decision 2 of 2: Ship it today\?/.test(askQ()) &&
        askOpts().length === 2 &&
        askOpts()[0].textContent.startsWith('Yes') &&
        /Decision 2 of 2/.test(q()) &&
        opts().length === 2
    )),
    'after the first answer the same row shows Decision 2 ("' + askQ() + '")'
  );
  const m2 = await marksNow();
  check(
    sent.length === 0 && !m2[e1.id + ':choices:0'] && !m2[e1.id + ':choices:1'],
    'nothing is sent or marked answered until the last decision is answered (sent ' +
      sent.length +
      ')'
  );

  // (The row's equal height was the old visible Overview row's; the agent's card is hidden, so its
  // height is 0. The next-steps card below keeps the equal-height check on a visible section.)
  check(
    asks().length === 1 && N.deciding(paneId)?.id === e1.id + '#1',
    'still one row, now for ' + N.deciding(paneId)?.id
  );
  console.log('TNAI_SHOT:decision-steps-second');
  await wait(600);

  // 3. The last answer sends one message naming both decisions and marks each answered.
  askOpts()[1].click();
  check(!!(await until(() => sent.length === 1)), 'the last answer sends one message');
  const text = sent[0]?.[1] || '';
  check(
    sent[0]?.[0] === paneId &&
      /Decision on "Decision 1 of 2: Which store\?": go with Memory\./.test(text) &&
      /Decision on "Decision 2 of 2: Ship it today\?": go with No\./.test(text) &&
      !/\n/.test(text) &&
      text.indexOf('Decision 1 of 2') < text.indexOf('Decision 2 of 2'),
    'it names each decision with its answer, in order, on one line: ' + text
  );
  const m3 = await until(async () => {
    const m = await marksNow();
    return (
      m[e1.id + ':choices:0']?.state === 'answered' &&
      m[e1.id + ':choices:1']?.state === 'answered' &&
      m
    );
  });
  check(!!m3, 'both decisions are marked answered, each on its own key');
  check(
    !!(await until(() => box.hidden && !asks().length && !N.deciding(paneId))),
    'the row goes away once all are answered'
  );
  opts()[0]?.click();
  await wait(150);
  check(sent.length === 1, 'a late second click sends nothing more');

  // 4. The next-steps card: one decision section that steps the same way, and the own-words reply
  // names its decision too.
  N.setMode('suggest');
  await main('finish', paneId, 'Elm', '[TN.ai] Pick a cache', REPORT('Which cache?'));
  const e2 = await until(() =>
    C.entries().find(
      e => e.paneId === paneId && /Which cache\?/.test(e.summary?.choices?.question || '')
    )
  );
  const next = () => document.querySelector('.tnai-next'),
    sec = () => next().querySelector('.n-sec[data-k="choices"]');
  await until(() => !next().hidden && next().querySelector('[data-item="' + e2?.id + '"]'));
  if (!sec()) {
    next().querySelector('.tnai-nitem.chip[data-act="expand"]')?.click();
    await wait(200);
  }
  check(
    !!(await until(
      () => sec() && /Decision 1 of 2: Which cache\?/.test(sec().querySelector('.n-q').textContent)
    )),
    'next-steps card: Decision 1 in its one decision section'
  );
  const secs = () => next().querySelectorAll('.n-sec[data-k="choices"]').length,
    sh1 = sec().getBoundingClientRect().height;
  sec().querySelector('[data-act="decide"][data-i="0"]').click();
  check(
    !!(await until(
      () =>
        sec() && /Decision 2 of 2: Ship it today\?/.test(sec().querySelector('.n-q').textContent)
    )) &&
      !next().hidden &&
      secs() === 1 &&
      sent.length === 1,
    'after the first answer the card stays, the one section shows Decision 2, nothing sent yet'
  );
  check(
    Math.abs(sec().getBoundingClientRect().height - sh1) < 1.5,
    'the section keeps its height (' +
      sh1.toFixed(1) +
      ' → ' +
      sec().getBoundingClientRect().height.toFixed(1) +
      ' px)'
  );
  const own = sec().querySelector('.n-other input');
  own.value = 'Tomorrow morning';
  own.dispatchEvent(new Event('input', { bubbles: true }));
  sec().querySelector('[data-act="decide"][data-i="other"]').click();
  check(!!(await until(() => sent.length === 2)), 'the last answer (own words) sends one message');
  check(
    /Decision on "Decision 1 of 2: Which cache\?": go with Memory\./.test(sent[1]?.[1] || '') &&
      /Decision on "Decision 2 of 2: Ship it today\?": Tomorrow morning/.test(sent[1]?.[1] || ''),
    'it names both decisions: ' + sent[1]?.[1]
  );
  check(
    !!(await until(async () => {
      const m = await marksNow();
      return (
        m[e2.id + ':choices:0']?.state === 'answered' &&
        m[e2.id + ':choices:1']?.state === 'answered'
      );
    })),
    'both are marked answered'
  );
} catch (e) {
  check(false, 'error: ' + (e?.stack || e));
} finally {
  if (A && realSend) A.send = realSend;
  try {
    N?.setMode('off');
  } catch {}
}
const shell = window.TnaiAgents.sessions().find(s => s.running);
if (shell) {
  window.TnaiAgents.stop(shell.paneId);
  await wait(300);
}
return { ok, log };
