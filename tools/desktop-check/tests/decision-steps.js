/*
 * Technically Not tools · desktop-check/tests/decision-steps.js — A report with several "- Decide:"
 * lines (real context store, fed by decision-steps.main.js on a real PowerShell thread; the send to
 * the agent is stood in, nothing is typed into it): every decision is kept, the waiting decision
 * (51 `deciding`) and the one section on the next-steps card step through them in order, the
 * section without changing size, each answer goes to the agent the moment it is given, naming the
 * decisions still open, and each decision is marked answered on its own. Returns {ok, log}.
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

  // The old Overview and its agent cards are deleted, and with them the card's one decision row
  // that stepped from Decision 1 to Decision 2 (its look and its buttons are no longer checked).
  // The flow behind that row is the app's own (49 `decide`, 51 `deciding`), and the visible
  // next-steps card in part 4 steps the same way; here it is driven the way the row's buttons
  // drove it (`TnaiContext.decide(id, option, 'send')`). The thread's own buttons (.tnt-decide in
  // the Readable view) are checked by thread-readable.

  // 1. Both decisions are kept; the first is the one waiting.
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
  const sum = C.summaryFor(paneId, e1.startedAt),
    perResult = !!sum && !('brief' in sum.dataset),
    sumRows = sum?.querySelectorAll?.('.s-row[data-k="choices"]').length;
  check(
    !perResult || sumRows === 2,
    perResult
      ? 'Result summary: one Decide row per decision (' + sumRows + ')'
      : 'Result summary: not visited (it shows the standing brief here, not this result)'
  );

  // 2. Answering the first sends it at once, naming Decision 2 as still open, and the waiting
  // decision moves on to the second (user 2026-10-28: each answer goes as it is pressed).
  // Options are in the report's order with the recommended one first: Memory, Disk.
  C.decide(d1.id, 0, 'send');
  const d2 = await until(() =>
    N.deciding(paneId)?.id === e1.id + '#1' ? N.deciding(paneId) : null
  );
  check(
    !!d2 && /Decision 2 of 2: Ship it today\?/.test(d2.question || ''),
    'after the first answer the waiting decision is Decision 2 ("' + (d2?.question || '') + '")'
  );
  check(!!(await until(() => sent.length === 1)), 'the first answer is sent at once');
  const text = sent[0]?.[1] || '';
  check(
    sent[0]?.[0] === paneId &&
      /Decision on "Decision 1 of 2: Which store\?": go with Memory\./.test(text) &&
      /keep these open: "Decision 2 of 2: Ship it today\?"/.test(text) &&
      !/\n/.test(text),
    'it names its decision and the one still open, on one line: ' + text
  );
  check(
    !!(await until(async () => (await marksNow())[e1.id + ':choices:0']?.state === 'answered')),
    'Decision 1 is marked answered on its own key'
  );
  console.log('TNAI_SHOT:decision-steps-second');
  await wait(600);

  // 3. The second answer is its own message, and no decision waits after it.
  // Decision 2's options: Yes (recommended), No.
  C.decide(e1.id + '#1', 1, 'send');
  check(!!(await until(() => sent.length === 2)), 'the second answer sends its own message');
  check(
    /Decision on "Decision 2 of 2: Ship it today\?": go with No\./.test(sent[1]?.[1] || '') &&
      !/keep these open/.test(sent[1]?.[1] || ''),
    'it names Decision 2 only: ' + sent[1]?.[1]
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
  check(!!(await until(() => !N.deciding(paneId))), 'no decision waits once all are answered');
  C.decide(e1.id + '#0', 0, 'send');
  await wait(150);
  check(sent.length === 2, 'a late second answer sends nothing more');

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
      sent.length === 3,
    'after the first answer the card stays, the one section shows Decision 2, the answer is sent'
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
  check(!!(await until(() => sent.length === 4)), 'the answer in own words sends its own message');
  check(
    /Decision on "Decision 1 of 2: Which cache\?": go with Memory\./.test(sent[2]?.[1] || '') &&
      /Decision on "Decision 2 of 2: Ship it today\?": Tomorrow morning/.test(sent[3]?.[1] || ''),
    'each names its own decision: ' + sent[2]?.[1] + ' / ' + sent[3]?.[1]
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
