// Technically Not tools · desktop-check/tests/cli-screen-tui-input.js — A full-screen-style CLI
// (like Claude Code's task list at the bottom) gets the same input as in a normal terminal: a fake
// TUI (cli-screen-tui-input.main.js) runs in a real PowerShell thread with SGR mouse tracking on
// and logs every byte it receives. REAL keys (↑ ↓ ← → Enter Esc Tab x) and REAL mouse clicks in the
// CLI screen of the session's thread (120) reach it; Ctrl+1 inside the terminal stays with the
// program; Shift+drag still selects text without reporting. Returns {ok, log}.
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
    await wait(80);
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
let inputSeq = 0;
const realInput = events =>
  new Promise(resolve => {
    const id = 'i' + ++inputSeq;
    (window.__tnaiInputDone ||= {})[id] = () => {
      delete window.__tnaiInputDone[id];
      resolve();
    };
    setTimeout(() => {
      if (window.__tnaiInputDone[id]) {
        log.push('info input ' + id + ' timed out');
        resolve();
      }
    }, 15000);
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const click = (x, y, modifiers = []) =>
  realInput([
    { type: 'mouseMove', x, y, modifiers },
    { type: 'mouseDown', x, y, modifiers },
    { type: 'mouseUp', x, y, modifiers },
  ]);
const pressKey = (keyCode, modifiers = []) =>
  realInput([
    { type: 'keyDown', keyCode, modifiers },
    { type: 'keyUp', keyCode, modifiers },
  ]);
const R = el => el.getBoundingClientRect();
const agents = window.TnaiAgents;
const buffer = async id => (await window.tnaiNative.pty.replay(id))?.buffer || '';
const got = async () => (await main('read')).join('');
const reportsIn = s => s.match(/\x1b\[<\d+;\d+;\d+[Mm]/g) || [];

// Waits until the TUI's log grows past `from` and contains every expected string (in order).
const received = async (from, expected, ms = 5000) =>
  until(async () => {
    const s = (await got()).slice(from);
    let at = 0;
    for (const e of expected) {
      at = s.indexOf(e, at);
      if (at < 0) return null;
      at += e.length;
    }
    return s;
  }, ms);

try {
  const { script, log: inLog } = await main('paths');
  await agents.detect(true);
  const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
  const paneId = started.paneId;
  check(!!started.session?.running, 'PowerShell thread running');
  await until(async () => /PS [A-Z]:/.test(await buffer(paneId)), 8000);
  agents.send(paneId, `node '${script}' '${inLog}' mouse`);
  check(
    !!(await until(async () => (await buffer(paneId)).includes('TUI READY'), 10000)),
    'fake TUI started with mouse tracking on'
  );
  await wait(300);

  // ---- its thread: a PowerShell thread has no conversation, so it opens on its screen
  window.TnaiThreads.show(paneId);
  const view = window.TnaiThreadView;
  await until(() => view.shown() === paneId, 8000);
  if (view.mode() !== 'term') view.setMode('term');
  const cli = window.TnaiThreads.slot('main').querySelector('.tnt-term-box');
  check(
    !!(await until(
      () =>
        view.term()?.tnaiPaneId === paneId &&
        cli.querySelector('.xterm-screen')?.getClientRects().length,
      10000
    )),
    'its thread shows the CLI screen'
  );
  await wait(900);

  // ---- CLI screen: real click focuses the terminal and is reported to the program (press +
  // release, SGR).
  const screen = cli.querySelector('.xterm-screen'),
    sr = R(screen);
  let mark = (await got()).length;
  await click(sr.left + 60, sr.top + sr.height - 30);
  await wait(200);
  check(
    cli.contains(document.activeElement),
    'real click focuses the terminal (' + (document.activeElement?.className || 'none') + ')'
  );
  let s = await received(mark, ['\x1b[<0;', 'M', '\x1b[<0;', 'm']);
  check(
    !!s,
    'click reported to the program as SGR press + release: ' +
      JSON.stringify(reportsIn(s || (await got())).slice(-2))
  );

  // ---- Real navigation keys reach the program unchanged.
  const KEYS = [
    ['Down', '\x1b[B'],
    ['Up', '\x1b[A'],
    ['Left', '\x1b[D'],
    ['Right', '\x1b[C'],
    ['Enter', '\r'],
    ['Escape', '\x1b'],
    ['Tab', '\t'],
    ['x', 'x'],
  ];
  for (const [key, bytes] of KEYS) {
    mark = (await got()).length;
    if (key === 'x') await realInput([{ type: 'char', keyCode: 'x' }]);
    else await pressKey(key);
    const r = await received(mark, [bytes], 3000);
    check(
      r !== null && r.includes(bytes),
      key +
        ' → ' +
        JSON.stringify(bytes) +
        ' (got ' +
        JSON.stringify(r ?? (await got()).slice(mark)) +
        ')'
    );
  }

  // Ctrl+1 inside the terminal stays with the program: the page does not change.
  await realInput([
    { type: 'keyDown', keyCode: '1', modifiers: ['control'] },
    { type: 'keyUp', keyCode: '1', modifiers: ['control'] },
  ]);
  await wait(300);
  check(
    window.TnaiThreads.visible() && view.shown() === paneId && cli.getClientRects().length > 0,
    'Ctrl+1 inside the terminal does not switch pages'
  );

  // ---- Shift+drag selects text and reports nothing (mouse tracking stays on).
  mark = (await got()).length;
  const y = sr.top + 12;
  await realInput([
    { type: 'mouseMove', x: sr.left + 8, y, modifiers: ['shift'] },
    { type: 'mouseDown', x: sr.left + 8, y, modifiers: ['shift'] },
    ...[1, 2, 3, 4].map(i => ({
      type: 'mouseMove',
      down: true,
      x: sr.left + 8 + i * 40,
      y,
      modifiers: ['shift', 'leftButtonDown'],
    })),
    { type: 'mouseUp', x: sr.left + 168, y, modifiers: ['shift'] },
  ]);
  await wait(250);
  const selected = cli.querySelectorAll('.xterm-selection div').length > 0;
  check(selected, 'Shift+drag selects text while the program has mouse tracking on');
  check(!reportsIn((await got()).slice(mark)).length, 'Shift+drag sent no mouse report');

  await cli.querySelector('.xterm-helper-textarea')?.focus();
  agents.send(paneId, 'q');
  check(
    !!(await until(async () => (await buffer(paneId)).includes('TUI DONE'), 5000)),
    'fake TUI quit'
  );
} catch (error) {
  check(false, 'test threw: ' + error.stack);
}
return { ok, log };
