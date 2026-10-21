// Technically Not tools · desktop-check/tests/prompt-picker.js — the "/" and "$" list above the
// prompt box (160-prompt-picker.js; user, 2026-10-21: "Yes, build all three", part 2).
//
// One plain PowerShell panel is opened and the open thread is told it runs Claude Code (its
// session's tool name only), so the list asks the real main process (desktop/cli-commands.js)
// for Claude Code's commands without starting any CLI. Nothing is sent: every Enter here is taken
// by the list, and the prompt box is emptied at the end. Checked:
// 1. "/mo" opens the list with /model first, saying "opens the CLI screen" when 161 knows it.
// 2. It sits above the prompt box, as wide as it, inside the window, and its fill is solid.
// 3. ↓ moves the highlight, Enter picks and writes "/model ", the list closes.
// 4. "$" lists skills, Esc closes it, the same word stays closed.
// 5. Pictures in Dark and Light, and at 1024 x 700.
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
    await wait(50);
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
const prompt = document.getElementById('prompt');
const list = () => document.querySelector('.tnai-pp');
const rows = () => [...document.querySelectorAll('.tnai-pp .tnai-pp-item')];
const selected = () => document.querySelector('.tnai-pp [aria-selected="true"]');
const box = node => node.getBoundingClientRect();

const type = text => {
  prompt.focus({ preventScroll: true });
  prompt.value = text;
  prompt.setSelectionRange(text.length, text.length);
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = name =>
  !prompt.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  );
const shot = name => window.TnaiTest?.shot?.(name) ?? wait(700);

// The open thread runs "Claude Code" as far as the list can tell: only the tool name of the one
// panel is changed, in what TnaiAgents.sessions hands out.
const realSessions = agents.sessions;
let pane = '';
agents.sessions = (...args) =>
  realSessions
    .apply(agents, args)
    .map(session => (session.paneId === pane ? { ...session, agent: 'Claude Code' } : session));

// Anything the prompt box tries to send while the test runs is caught here, not sent.
const realSend = agents.send;
const sends = [];
agents.send = (paneId, text) => {
  sends.push(text);
  return true;
};

try {
  threads.open();
  await until(() => threads.visible(), 5000);
  pane = (await window.TnaiTest.open('Terminal'))?.paneId || '';
  await until(() => realSessions.call(agents).find(s => s.paneId === pane && s.running), 15000);
  threads.select(pane);
  await until(() => window.TnaiLiveTasks?.target?.() === pane, 4000);

  // A plain PowerShell panel may not count as a thread: then the prompt box is aimed at it.
  if (window.TnaiLiveTasks?.target?.() !== pane) window.TnaiLiveTasks?.setTarget?.(pane);
  check(!!pane && window.TnaiLiveTasks.target() === pane, 'setup: the panel is the open thread');

  // ---- 1. "/mo" ----
  type('/mo');
  const opened = await until(() => rows().length > 0, 4000);
  check(!!opened, '"/mo" opens the list');
  const first = rows()[0];
  check(first?.querySelector('code')?.textContent === '/model', 'its first row is /model');
  const menuKnown = window.TnaiCliMenus?.opensScreen?.('Claude Code', '/model');
  check(
    first?.querySelector('em')?.textContent === (menuKnown ? 'opens the CLI screen' : 'runs here'),
    '/model says what happens: ' + first?.querySelector('em')?.textContent
  );
  check(
    /Commands of Claude Code/.test(list()?.querySelector('h4')?.textContent || ''),
    'the list is titled with the CLI'
  );

  // ---- 2. where it sits and how it looks ----
  const measure = async label => {
    // TnaiFloat places the list a frame after it is painted.
    await until(() => list()?.dataset.side === 'top', 2000);
    await wait(150);
    const composer = box(prompt.closest('.composebox'));
    const pick = box(list());
    check(pick.bottom <= composer.top + 1, label + ': above the prompt box');
    check(Math.abs(pick.width - composer.width) <= 2, label + ': as wide as the prompt box');
    check(
      pick.left >= 0 && pick.top >= 0 && pick.right <= innerWidth,
      label + ': inside the window'
    );
    const style = getComputedStyle(list());
    check(
      /gradient/.test(style.backgroundImage) && style.backgroundColor !== 'rgba(0, 0, 0, 0)',
      label + ': a solid fill (panel over the ground)'
    );
  };
  type('/');
  await until(() => rows().length > 5, 3000);
  await measure('wide window');
  await shot('prompt-picker-dark');
  window.TnaiTheme.set('light');
  await wait(300);
  await shot('prompt-picker-light');
  window.TnaiTheme.set('dark');
  await wait(300);

  // ---- 3. keys ----
  type('/mo');
  await until(() => rows().length > 0, 3000);
  const before = selected()?.querySelector('code')?.textContent;
  check(key('ArrowDown'), '↓ is taken by the list');
  check(selected()?.querySelector('code')?.textContent !== before, '↓ moves the highlight');
  check(key('ArrowUp'), '↑ is taken by the list');
  check(key('Enter'), 'Enter is taken by the open list');
  check(prompt.value === '/model ', 'Enter wrote "/model " (' + JSON.stringify(prompt.value) + ')');
  check(!list(), 'the list closed after the pick');
  check(sends.length === 0, 'nothing was sent');

  // ---- 4. "$" and Esc ----
  type('use $');
  const skills = await until(() => rows().length > 0, 3000);
  log.push('info "$" rows: ' + rows().length);
  if (skills) {
    check(
      /Skills for Claude Code/.test(list()?.querySelector('h4')?.textContent || ''),
      '"$" lists the skills'
    );
    check(key('Escape') && !list(), 'Esc closes it');
    type('use $t');
    await wait(150);
    check(!list(), 'the word Esc closed stays closed');
  } else log.push('note no skill on this PC for Claude Code: "$" not checked');

  // ---- what the prompt box sends for a picked command (caught above, never sent) ----
  // Written down, not judged: how a command reaches the CLI belongs to 11, not to this list.
  type('/model');
  key('Escape');
  key('Enter');
  await until(() => sends.length > 0, 3000);
  log.push('info the prompt box handed on: ' + JSON.stringify(sends[0] ?? '(nothing)'));
  type('');

  // ---- 5. a small window ----
  await main('size', 1024, 700);
  type('/');
  await until(() => rows().length > 0, 3000);
  await measure('1024 x 700');
  await shot('prompt-picker-small');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
type('');
prompt.blur();
agents.sessions = realSessions;
agents.send = realSend;
if (pane) agents.stop(pane);
await wait(300);
return { ok, log };
