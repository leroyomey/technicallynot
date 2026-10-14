/*
 * Technically Not tools · desktop-check/tests/trust-ask.js — The folder-trust question (main.js
 * askInPane → 74-trust-ask.js, shown by 121) stands in the agent's own thread, not as a window:
 * it shows in the open thread's row with the app's words and buttons, fits inside the thread,
 * comes back when a redraw removes it, a button answers it (every copy goes, main gets
 * trust:answer), and trust:done removes it. The questions are pushed by trust-ask.main.js for a
 * real PowerShell thread; no agent CLI starts. (The question on a card of the All threads page is
 * the test all-threads-asks.) Returns {ok, log}.
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
    await wait(100);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const layers = id => [...document.querySelectorAll('[data-trust-ask="' + id + '"]')];

// A layer a user can see: it takes room on screen.
const onScreen = id => layers(id).filter(layer => layer.getClientRects().length > 0);
try {
  await Promise.resolve(window.TnaiSessionStart?.ready);
  await wait(1200);

  // The agent the question is about: a real PowerShell thread, open on the Threads page.
  const started = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
  const paneId = started.paneId;
  check(!!started.session?.running, 'a PowerShell thread runs and is the open thread');
  await until(() => window.TnaiThreadView.shown() === paneId, 6000);
  await main('ask', {
    id: 'trust-t1',
    paneId,
    title: 'Trust "sample-project" for Codex?',
    body: 'The agent you started needs it.',
    ok: 'Trust folder',
    cancel: "Don't allow",
  });

  // The open thread's row shows it, with the app's own words and buttons.
  const threadSel = '.tnt-ask[data-trust-ask="trust-t1"]';
  const inThread = await until(() => document.querySelector(threadSel), 5000);
  check(!!inThread, 'question shown in the open thread row');
  await wait(300);
  check(
    inThread?.querySelector('b')?.textContent === 'Trust "sample-project" for Codex?',
    'it shows the title (' + (inThread?.querySelector('b')?.textContent || 'none') + ')'
  );
  const view = document.querySelector('.tnt-view'),
    vr = view?.getBoundingClientRect(),
    tr = inThread?.getBoundingClientRect(),
    tb = [...(inThread?.querySelectorAll('button') || [])];
  check(
    !!tr &&
      !!vr &&
      tr.width > 0 &&
      tr.left >= vr.left &&
      tr.right <= vr.right + 0.5 &&
      tr.top >= vr.top &&
      tr.bottom <= vr.bottom + 0.5,
    'it fits inside the thread'
  );
  check(
    tb.map(b => b.textContent).join('|') === "Don't allow|Trust folder" &&
      tb.every(b => {
        const r = b.getBoundingClientRect();
        return (
          r.width > 0 &&
          document
            .elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            ?.closest('button') === b
        );
      }),
    'both buttons, "Don\'t allow" and "Trust folder", are visible and clickable there'
  );
  check(
    onScreen('trust-t1').length === 1,
    'a user sees the question once (' + onScreen('trust-t1').length + ' copies on screen)'
  );
  const titles = [...document.querySelectorAll('[id^="tnaiTrust-trust-t1"]')].map(n => n.id);
  check(
    titles.length >= 1 && new Set(titles).size === titles.length,
    'each copy of the question has its own title id (' + titles.join(', ') + ')'
  );
  console.log('TNAI_SHOT:trust-ask-thread');
  await wait(600);

  // Another thread is opened and this one again: the question is still there.
  const other = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
  await until(() => window.TnaiThreadView.shown() === other.paneId, 6000);
  await wait(300);
  check(
    !onScreen('trust-t1').length,
    'with another thread open the question is not on screen: it belongs to its own thread'
  );
  window.TnaiThreads.show(paneId);
  const back = await until(() => {
    const row = document.querySelector(threadSel);
    return row?.getClientRects().length ? row : null;
  }, 5000);
  check(!!back, 'back in its thread the question is shown again');

  // Answering it takes it off the screen at once. The copies nobody sees (the app keeps one per
  // place the agent can be shown) go when the main process says the question is done, which it
  // does after a real answer; here the question is made up, so the test says it.
  back?.querySelector('.tnt-ask-yes')?.click();
  check(
    !!(await until(() => !onScreen('trust-t1').length, 3000)),
    'the answer takes the question off the screen'
  );
  await main('done', 'trust-t1');
  check(
    !!(await until(
      () => !layers('trust-t1').length && !document.querySelector('[data-trust-asking]'),
      3000
    )),
    'and once the main process says it is done, no copy of it is left anywhere'
  );

  // trust:done (answered elsewhere, or its panel closed) removes it too.
  await main('ask', {
    id: 'trust-t2',
    paneId,
    title: 'Trust?',
    body: '',
    ok: 'Trust folder',
    cancel: "Don't allow",
  });
  await until(() => layers('trust-t2').length);
  await main('done', 'trust-t2');
  await until(() => !layers('trust-t2').length, 3000);
  check(!layers('trust-t2').length, 'trust:done removes the question');
  check(Array.isArray(await window.tnaiNative.trust.pending()), 'trust:pending answers');
  check((await window.tnaiNative.trust.answer('nope', true)) === false, 'unknown answer refused');
  for (const id of [paneId, other.paneId]) window.TnaiAgents.stop(id);
  await wait(300);
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
return { ok, log };
