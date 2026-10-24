/*
 * Technically Not tools · desktop-check/tests/real-thread.after.js — after real-thread.js stopped
 * its real Claude Code session and the window was reloaded: the restored, stopped session in the
 * thread layout. Its thread opens as its conversation again, read from the same record with no
 * process running. As a terminal it shows the saved screen filling the island (the trial of
 * 2026-10-08 showed a restored session at the wrong width), its character is asleep, and Enter in
 * the terminal starts it again in the same conversation. No prompt is sent here, so no model
 * usage. The window is reloaded, not the whole app: a full restart of the app is not visited.
 * Pictures: real-thread-restored, real-thread-resumed.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = label => log.push('     ' + label);
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(700);
};
const agents = window.TnaiAgents,
  threads = window.TnaiThreads,
  view = () => window.TnaiThreadView;
const box = el => el.getBoundingClientRect();
const shown = el => !!el && el.getClientRects().length > 0;
const n = v => Math.round(v * 10) / 10;
const paneId = localStorage.getItem('tnai.test.real-thread-pane') || '';
const allRows = term => {
  const b = term.buffer.active,
    rows = [];
  for (let y = 0; y < b.length; y++) rows.push(b.getLine(y)?.translateToString(true) || '');
  return rows;
};
const numbersIn = text => {
  const found = new Set(text.match(/\b\d{1,3}\b/g) || []);
  return Array.from({ length: 120 }, (_, i) => String(i + 1)).filter(x => found.has(x)).length;
};
const rowOf = () =>
  threads
    .slot('list')
    ?.querySelector('.tnt-th[data-pane="' + CSS.escape(paneId) + '"]:not(.tnt-sub)');

try {
  check(!!paneId, 'the first part left its panel id (' + paneId + ')');
  check(
    !!(await until(() => threads.visible(), 8000)),
    'after the reload the Threads page is the start page'
  );
  const session = await until(() => agents.sessions().find(s => s.paneId === paneId), 10000);
  check(
    !!session && !session.running,
    'the session is restored and not running (' +
      JSON.stringify(session && { running: session.running, status: session.status }) +
      ')'
  );
  check(!!(await until(() => rowOf(), 6000)), 'it has its thread row');
  threads.select(paneId);
  check(!!(await until(() => view().shown() === paneId, 12000)), 'its thread opens');
  const island = threads.slot('main'),
    talk = island.querySelector('.tnt-talk');

  // A row of the thread's own "..." menu (137), pressed the way a user does. The Readable /
  // Terminal switch is gone: the tool's own screen is the row "CLI screen", and from there the
  // row "Back to the conversation" (their ids: screen, conversation).
  const menuRow = async id => {
    island.querySelector('.tnt-head-menu')?.click();
    const row = await until(
      () =>
        document.querySelector(
          '.tnt-menu-thread:not([hidden]) .tnt-menu-row[data-row="' + id + '"]'
        ),
      3000
    );
    row?.click();
    return !!row;
  };

  // ---- the conversation of a session that is not running ----
  const read = await until(() => {
    const list = talk.querySelector('.tnt-talk-list');
    return list?.querySelector('.tnt-you') && list.querySelector('.tnt-worked') ? list : null;
  }, 12000);
  check(
    view().mode() === 'read' && !!read,
    'it opens as its conversation, read from the record with no process running'
  );
  if (read) {
    const said = [...read.querySelectorAll('.tnt-say')].map(b => b.innerText).join('\n');
    check(
      numbersIn(said) === 120 &&
        /Do these three things/.test(read.querySelector('.tnt-you').textContent),
      'the prompt and the whole reply are there (' + numbersIn(said) + ' of the 120 numbers)'
    );
    check(
      !shown(read.querySelector('.tnt-live')),
      'no "working" line stands under a session that is not running'
    );
  }
  check(
    rowOf()?.querySelector('.tnt-av')?.hasAttribute('data-asleep'),
    'its letter is dimmed (tone ' + (rowOf()?.dataset.tone || 'none') + ')'
  );
  {
    const state = island.querySelector('.tnt-head-state');
    note('top row state: "' + state.textContent.trim() + '" (tone ' + state.dataset.tone + ')');
  }
  await shot('real-thread-restored');

  // ---- its terminal: the saved screen, then Enter starts it again ----
  check(await menuRow('screen'), 'the "..." menu of the stopped thread has the row "CLI screen"');
  const term = await until(() => {
    const t = view().mode() === 'term' ? view().term() : null;
    return t?.element && shown(t.element) && box(t.element).height > 40 ? t : null;
  }, 12000);
  check(!!term, 'CLI screen shows its terminal');
  if (!term) throw new Error('no terminal for the restored session');
  await wait(2000);
  const host = island.querySelector('.tnt-term-host'),
    h = box(host),
    screen = box(host.querySelector('.xterm-screen'));
  check(
    numbersIn(allRows(term).join('\n')) >= 110,
    'the saved screen is shown, with the reply in it'
  );
  check(
    screen.width > h.width * 0.9 &&
      screen.bottom <= h.bottom + 1 &&
      h.bottom <= box(island).bottom + 1,
    'it fills the island at the width of the island (' +
      n(screen.width) +
      ' of ' +
      n(h.width) +
      ', ' +
      term.cols +
      ' x ' +
      term.rows +
      ')'
  );

  // Enter in the terminal of the thread starts the stopped session again (10 stoppedInput).
  const type = text =>
    term.input ? term.input(text, true) : term._core.coreService.triggerDataEvent(text, true);
  type('\r');
  const runs = await until(
    () => agents.sessions().find(s => s.paneId === paneId && s.running),
    30000
  );
  check(!!runs, 'Enter in the terminal starts the session again');
  if (!runs) {
    // one run names the cause: what the session says, and what the terminal shows at its end
    const now = agents.sessions().find(s => s.paneId === paneId);
    note(
      'the session: ' +
        JSON.stringify(
          now && {
            running: now.running,
            status: now.status,
            canResume: now.canResume,
            error: now.error,
          }
        )
    );
    note(
      'the terminal ends with: ' +
        JSON.stringify(
          allRows(term)
            .filter(r => r.trim())
            .slice(-5)
        )
    );
    note(
      'the keyboard is in: ' +
        (document.activeElement?.className || document.activeElement?.tagName || 'nothing')
    );
    await shot('real-thread-not-resumed');
  }
  if (runs) {
    const back = await until(
      () =>
        /\? for shortcuts|shift\+tab|manual mode on|esc to/i.test(
          allRows(term).slice(-term.rows).join('\n')
        ),
      40000
    );
    check(!!back, 'Claude Code is back on screen in the same thread');
    const size = agents.ptySize.get(paneId);
    check(
      !!size && size.cols === term.cols && size.rows === term.rows,
      'at the size of the view (' + term.cols + ' x ' + term.rows + ')'
    );
    await wait(1500);
    await shot('real-thread-resumed');
    await agents.stop(paneId);
    await until(() => !agents.sessions().find(s => s.paneId === paneId)?.running, 10000);
  }
  await wait(300);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
  if (paneId) agents.stop(paneId);
}
localStorage.removeItem('tnai.test.real-thread-pane');
return { ok, log };
