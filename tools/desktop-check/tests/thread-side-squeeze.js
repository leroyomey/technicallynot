// Technically Not tools · desktop-check/tests/thread-side-squeeze.js — a thread beside a wide side
// column. A stopped session is shown as a thread, the side column is
// made wider in steps and brought back. At every width: the terminal has followed within a moment
// (it waited 1.2 s, its rows cut at the edge), nothing in the thread's top row lies over anything
// else and its name keeps room while the state word shows, and nothing in the row under the prompt
// box lies over anything else ("Access" lay over the key hint).
// Returns {ok, log}.
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
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value);

// Pairs of shown texts of a row that lie over each other.
const overlaps = row => {
  const parts = [...row.querySelectorAll('*')].filter(
    el => el.getClientRects().length && !el.children.length && el.textContent.trim()
  );
  const found = [];
  for (let first = 0; first < parts.length; first++)
    for (let second = first + 1; second < parts.length; second++) {
      const one = box(parts[first]);
      const two = box(parts[second]);
      const across = Math.min(one.right, two.right) - Math.max(one.left, two.left);
      const down = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
      if (across > 2 && down > 2)
        found.push(
          parts[first].textContent.trim().slice(0, 18) +
            ' | ' +
            parts[second].textContent.trim().slice(0, 18)
        );
    }
  return found;
};

let id = '';
try {
  await agents.detect(true);
  id = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  check(
    !!(await until(() => agents.sessions().find(s => s.paneId === id && s.running))),
    'setup: a PowerShell session runs'
  );
  await wait(1200);
  window.tnaiNative.pty.write(id, "cls; Write-Host ('-' * 200); Write-Host 'hello there'\r");
  await wait(1200);
  await agents.stop(id);
  check(
    !!(await until(() => agents.sessions().find(s => s.paneId === id && !s.running))),
    'setup: it is stopped'
  );
  threads.open();
  threads.show(id);
  await wait(800);
  threads.side(true);
  await wait(600);
  const head = document.querySelector('.tnt-head');
  const hints = document.querySelector('footer.composer > .hints');
  const main = threads.slot('main');
  const term = () =>
    agents.views().find(v => v.paneId === id && box(v.term.element).width > 0)?.term;

  // An agent's thread has more in its top row than a PowerShell one: a state word and every
  // button. All are shown here, so the row is as full as it gets.
  const fillHead = () => {
    const state = head.querySelector('.tnt-head-state');
    state.hidden = false;
    state.querySelector('span').textContent = 'Not started · press Enter';
    for (const part of head.querySelectorAll('.tnt-head-acts [hidden]')) part.hidden = false;

    // and the row under the prompt box holds the marks of seven agents, as in a busy project
    const marks = hints.querySelector('.tnai-to');
    if (marks) marks.style.minWidth = '150px';
  };

  // The columns that fit the terminal's box now.
  const fits = () => {
    const now = term();
    const host = now?.element?.parentElement;
    const cell = now?._core?._renderService?.dimensions?.css?.cell?.width;
    return now && cell ? { cols: now.cols, room: Math.floor(host.clientWidth / cell) } : null;
  };
  const measure = async label => {
    fillHead();
    await wait(120);
    const size = fits();
    check(
      !!size && size.cols <= size.room && size.cols >= size.room - 3,
      label +
        ': the terminal has the width of its box 120 ms later (' +
        size?.cols +
        ' columns, room for ' +
        size?.room +
        ')'
    );
    const screen = main.querySelector('.tnt-term .xterm-screen');
    check(
      !screen || box(screen).top >= box(head).bottom - 1,
      label + ': the terminal starts under the top row'
    );
    const overHead = overlaps(head);
    check(
      !overHead.length,
      label + ': nothing in the top row overlaps (' + overHead.join('; ') + ')'
    );
    const outside = [...head.querySelectorAll('.tnt-head-acts > *')].filter(
      part => part.getClientRects().length && box(part).right > box(head).right + 1
    );
    check(!outside.length, label + ': every button of the top row is inside it');
    const name = head.querySelector('h1');
    check(
      box(name).width >= 60 || (box(name).width > 0 && name.scrollWidth <= name.clientWidth),
      label + ": the thread's name is whole or has 60 px (" + round(box(name).width) + ' px)'
    );
    const pastEdge = [...hints.querySelectorAll('.tnai-pickers *')].filter(
      part => part.getClientRects().length && box(part).right > box(hints).right + 1
    );
    check(
      !pastEdge.length,
      label +
        ': the pickers end inside their row (' +
        pastEdge.map(part => round(box(part).right - box(hints).right) + ' px past').join(', ') +
        ')'
    );
    const overHints = overlaps(hints);
    check(
      !overHints.length,
      label + ': nothing under the prompt box overlaps (' + overHints.join('; ') + ')'
    );
  };

  await measure('usual width, thread ' + round(box(main).width) + ' px');
  const usual = box(threads.slot('side')).width;
  for (const more of [100, 200, 350, 700]) {
    window.TnaiThreadSideSize.set(usual + more);
    await measure('side column ' + more + ' px wider, thread ' + round(box(main).width) + ' px');
  }
  console.log('TNAI_SHOT:thread-side-squeeze-narrow');
  await wait(600);
  window.TnaiThreadSideSize.set(usual);
  await measure('back at the usual width');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
await agents.stop(id).catch(() => {});
return { ok, log };
