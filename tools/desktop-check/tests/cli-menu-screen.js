// Technically Not tools · desktop-check/tests/cli-menu-screen.js — a menu command sent from the
// prompt box opens the CLI screen in the thread's place, and the conversation comes back when the
// menu closes (161-cli-menu-screen.js; user, 2026-10-21: "Yes, build all three").
//
// A real Claude Code panel is started and gets no prompt: /model only opens Claude Code's own
// menu and Esc closes it without a change, so nothing is spent. Checked:
// 1. /model sent the way the prompt box sends it opens the CLI screen with the line on top, and
//    the menu stays open (no second Enter picks an option, desktop/prompt-submit.js).
// 2. Esc on the screen closes the menu and the conversation comes back by itself.
// 3. /model again, then "Back to the thread": the menu is closed and the conversation is back.
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
const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;
const view = () => window.TnaiThreadView;
const menus = () => window.TnaiCliMenus;

// Claude Code's screen, replayed into a scratch terminal: only to answer its folder-trust
// question and to see that it reached its empty prompt.
async function replayed(paneId) {
  const replay = await native.pty.replay(paneId);
  if (!replay?.buffer) return [];
  const screen = new window.Terminal({
    cols: replay.cols || 120,
    rows: replay.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => screen.write(replay.buffer, done));
  const buffer = screen.buffer.active;
  const rows = [];
  for (let y = 0; y < screen.rows; y++)
    rows.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) || '');
  screen.dispose();
  return rows;
}
const ready = paneId =>
  until(async () => {
    const rows = await replayed(paneId);
    const text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const selected = rows.find(row => row.includes('❯')) || '';
      native.pty.write(paneId, /Yes/i.test(selected) ? '\r' : '\x1b[B');
      await wait(700);
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text);
  }, 60000);

// What the thread's CLI screen shows now.
const screenNow = () => {
  const term = view()?.term?.();
  const buffer = term?.buffer?.active;
  if (!buffer) return '';
  const rows = [];
  for (let row = 0; row < term.rows; row++)
    rows.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '');
  return rows.join('\n');
};
const bar = () => document.querySelector('.tnt-view .tnt-term-bar');
const shown = node => !!node && !node.hidden && node.getClientRects().length > 0;

let pane = '';
try {
  threads.open();
  await until(() => threads.visible(), 5000);
  const opened = await window.TnaiTest.open('Claude Code');
  pane = opened?.paneId || (await until(() => agents.sessions()[0]))?.paneId || '';
  const running = await until(
    () => agents.sessions().find(session => session.paneId === pane && session.running),
    30000
  );
  if (!running || !(await ready(pane))) {
    log.push('note Claude Code did not start or reach its prompt on this PC: nothing was checked');
    return { ok, log };
  }
  threads.select(pane);
  await until(() => view()?.shown?.() === pane, 4000);
  view().setMode('read');
  await until(() => view().mode() === 'read', 2000);
  check(menus()?.opensScreen?.('Claude Code', '/model'), 'setup: /model is a menu command');

  // ---- 1. /model opens the CLI screen, and its menu stays open ----
  // Through the real prompt box, as the user sends it: its words reach the CLI as typed (no
  // "[TN.ai]" mark around a lone slash command, 11).
  const typed = [];
  const realSend = agents.send;
  agents.send = (paneId, text, options) => {
    typed.push(text);
    return realSend.call(agents, paneId, text, options);
  };
  try {
    const input = document.getElementById('prompt');
    input.value = '/model';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('send').click();
    await until(() => typed.length > 0, 5000);
  } finally {
    agents.send = realSend;
  }
  check(
    typed[0] === '/model',
    'the prompt box sends /model as typed (' + JSON.stringify(typed) + ')'
  );
  const onScreen = await until(() => view().mode() === 'term' && shown(bar()), 5000);
  check(!!onScreen, 'the thread shows its CLI screen with the line on top');
  check(/\/model/.test(bar()?.textContent || ''), 'the line names the command');
  const menuShown = await until(() => menus().menuOpen(screenNow()), 5000);
  check(!!menuShown, 'Claude Code’s model menu is on the screen');
  await wait(2500);
  check(
    menus().menuOpen(screenNow()) && view().mode() === 'term',
    'the menu is still open a moment later: no second Enter picked an option'
  );
  await window.TnaiTest?.shot?.('cli-menu-screen-open');

  log.push(
    'info active ' +
      JSON.stringify(menus().active()) +
      ', screen events ' +
      typeof view().term()?.onWriteParsed +
      ', mode ' +
      view().mode()
  );

  // ---- 2. Esc closes the menu, the conversation comes back ----
  native.pty.write(pane, '\x1b');
  await wait(1500);
  log.push(
    'info after Esc: menu ' +
      menus().menuOpen(screenNow()) +
      ', active ' +
      JSON.stringify(menus().active()) +
      ', last lines: ' +
      JSON.stringify(screenNow().split('\n').filter(Boolean).slice(-4))
  );
  const backByItself = await until(() => view().mode() === 'read' && !shown(bar()), 5000);
  check(!!backByItself, 'Esc on the screen closes the menu and the conversation comes back');

  // ---- 3. Back to the thread ----
  await native.pty.submit(pane, '/model', {});
  await until(() => view().mode() === 'term' && menus().menuOpen(screenNow()), 6000);
  bar()?.querySelector('button')?.click();
  await wait(800);
  check(view().mode() === 'read', '"Back to the thread" brings the conversation back');
  check(!menus().menuOpen(screenNow()), 'and the menu it left is closed');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
agents.sessions().forEach(session => agents.stop(session.paneId));
await until(() => !agents.sessions().some(session => session.running), 10000);
await wait(300);
return { ok, log };
