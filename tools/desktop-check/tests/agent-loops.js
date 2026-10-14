/*
 * Technically Not tools · desktop-check/tests/agent-loops.js — Stuck-loop notices end to end:
 * Claude Code hook payloads go through the real hook server into desktop/agent-loops.js
 * (agent-loops.main.js, test clock), and 85 shows the bell notice. Long browser work with a
 * changing page stays quiet; a click that keeps showing the same page gives one "may be stuck"
 * notice (not one per repeat); a different step clears it. No CLI, no prompt, no usage.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(25);
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

const paneId = 'agent-loops-test-pane',
  CHROME = 'mcp__claude-in-chrome__computer',
  shot = { action: 'screenshot', tabId: 3 };
const B = window.TnaiNextActions;
const rows = () => {
  B.openBell(true);
  return [...document.querySelectorAll('.tnai-bell-pop .tnai-nitem')].filter(n =>
    /may be stuck in a loop/.test(n.querySelector('.n-who b')?.textContent || '')
  );
};

// Normal long browser work: screenshots of a page that changes, scrolling, one file read again with
// new text.
const normal = [];
for (let i = 0; i < 20; i++)
  normal.push(
    [CHROME, shot, [{ type: 'image', data: 'listing-' + i }]],
    [CHROME, { action: 'scroll', coordinate: [600, 400], scroll_direction: 'down' }, 'Scrolled'],
    ['Read', { file_path: 'notes.txt' }, 'v' + (i >> 2)]
  );
await main('play', paneId, normal, 'Add the app to the directory listings');
await wait(300);
check(!rows().length, 'long browser work with a changing page: no notice');
check(!window.TnaiAgentLoops.open().length, 'no open loop');

// A real loop: the same click and the same screenshot result, 10 cycles (~7 min on the test clock).
const stuck = [];
for (let i = 0; i < 10; i++)
  stuck.push(
    [CHROME, { action: 'left_click', coordinate: [812, 640] }, 'Clicked'],
    [CHROME, shot, [{ type: 'image', data: 'same-page' }]]
  );
await main('play', paneId, stuck);
const row = await until(() => rows()[0]);
check(!!row, 'a real loop shows a bell notice');
row?.click();
await wait(100);
const open = rows()[0];
const text = open?.querySelector('.n-ask')?.textContent || '';
check(
  /repeated the same 2 browser steps \d+ times in \d+ min, with the same result each time/.test(
    text
  ),
  'plain words: what repeated, how often, how long (' + text.slice(0, 90) + ')'
);
check(open?.querySelector('[data-act="notice"]')?.textContent === 'Go to it', 'Go to it button');
await main('play', paneId, stuck.slice(0, 6));
await wait(300);
check(rows().length === 1, 'still looping: one notice, not one per repeat (' + rows().length + ')');

// It moves on: a different step clears the notice.
await main('play', paneId, [
  [CHROME, { action: 'navigate', url: 'https://example.com/next' }, 'Navigated'],
]);
check(
  !!(await until(() => !rows().length && !window.TnaiAgentLoops.open().length)),
  'a different step clears the notice'
);
B.openBell(false);

await main('done', paneId);
return { ok, log };
