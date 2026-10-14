/*
 * Technically Not tools · desktop-check/tests/cli-screen-scroll-jump.js — A terminal at the newest
 * output stays there, and one the user scrolled up keeps its place, through (b) its box made
 * larger and back, (a) a compact (the CLI clears the screen and scrollback and draws
 * the conversation again) and (c) real mouse-wheel notches (cli-screen-scroll-jump.main.js), with
 * Claude Code's mouse reporting on. The terminal is the CLI screen of a real PowerShell thread
 * (120) on the WebGL renderer, 3000 lines of scrollback. It was written for two panels of the
 * Terminal page's grid and a panel's maximize and restore; a thread's screen has no maximize, so
 * the window is made larger and back, which changes the screen's size the same way.
 * No agent CLI. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = s => log.push('     ' + s);
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
window.__tnaiDomRenderer = false;
try {
  localStorage.removeItem('tnai.test.dom-renderer');
} catch {}
const agents = window.TnaiAgents;
const windows = /Windows/.test(navigator.userAgent);
const buffer = async id => (await window.tnaiNative.pty.replay(id))?.buffer || '';
const terms = new Set();
await agents.createTerm().then(m => m.term.dispose());
const RealTerminal = window.Terminal;
window.Terminal = class extends RealTerminal {
  constructor(...a) {
    super(...a);
    terms.add(this);
  }
};
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const E = '\\x1b';
try {
  await agents.detect(true);
  await main('setSize', 1300, 850);
  await wait(300);
  window.TnaiThreads.open();
  const threadId = (await window.TnaiTest.open('Terminal'))?.paneId || '';
  await until(async () => (windows ? /PS [A-Z]:/ : /[$#] $/m).test(await buffer(threadId)), 15000);

  // The thread's CLI screen: a PowerShell thread has no conversation, so it opens on its screen.
  // `A` stands where the first panel stood, so the steps below read as they did.
  const view = window.TnaiThreadView;
  window.TnaiThreads.show(threadId);
  await until(() => view.shown() === threadId, 8000);
  if (view.mode() !== 'term') view.setMode('term');
  check(
    !!(await until(
      () => view.term()?.tnaiPaneId === threadId && view.term().element?.getClientRects().length,
      10000
    )),
    'the PowerShell thread shows its CLI screen'
  );
  const A = { dataset: { paneId: threadId } };
  const all = [A];
  const termOf = () => view.term();

  // The screen's box larger and back: the window, since a thread's screen has no maximize.
  const bigger = async () => {
    await main('setSize', 1500, 980);
  };
  const smaller = async () => {
    await main('setSize', 1300, 850);
  };
  const st = pane => {
    const b = termOf(pane)?.buffer.active;
    return b ? (b.viewportY === b.baseY ? 'B' : 'U' + (b.baseY - b.viewportY)) : '?';
  };
  const state = () => all.map(st).join('/');
  const run = async (panes, tag, cmd) => {
    for (const p of panes) agents.send(p.dataset.paneId, cmd + '; "' + tag + 'DONE"');
    for (const p of panes)
      await until(async () => (await buffer(p.dataset.paneId)).includes(tag + 'DONE\r'), 20000);
    await wait(400);
  };
  const print = (panes, tag, n) =>
    run(
      panes,
      tag,
      windows
        ? '1..' + n + ' | % { "' + tag + ' $_" }'
        : 'for i in $(seq 1 ' + n + '); do echo "' + tag + ' $i"; done'
    );
  const frames = async (n = 20) => {
    const seen = [];
    for (let i = 0; i < n; i++) {
      await frame();
      seen.push(state());
    }
    await wait(300);
    seen.push(state());
    return seen.join(' ');
  };
  const mouseOn = pane =>
    // what Claude Code turns on
    new Promise(r => termOf(pane).write('\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h', r));
  await print(all, 'F', 3000);
  check(
    state() === 'B',
    'the CLI screen is at the newest output after 3000 lines (' + state() + ')'
  );

  // (b) larger and back, three rounds (a race shows only sometimes); the second with Claude
  // Code's mouse reporting on.
  for (let r = 0; r < 3; r++) {
    if (r === 1) await mouseOn(A);
    await bigger();
    const m = await frames();
    check(
      st(A) === 'B',
      'round ' + (r + 1) + ': made larger, at the newest output (per frame: ' + m + ')'
    );
    await smaller();
    const s = await frames();
    check(
      state() === 'B',
      'round ' + (r + 1) + ': back at its size, at the newest output (per frame: ' + s + ')'
    );
    await print(all, 'M' + r, 30);
    check(state() === 'B', 'round ' + (r + 1) + ': new output still followed (' + state() + ')');
  }

  // Scrolled up by the user: keeps its place through larger and back.
  {
    const t = termOf(A),
      b = t.buffer.active,
      top = () => b.getLine(b.viewportY)?.translateToString(true).trim();
    t.scrollLines(-200);
    await wait(200);
    const was = top();
    await bigger();
    await frames();
    const atMax = top();
    await smaller();
    await frames();
    const num = x => Number(/\d+$/.exec(x || '')?.[0]);

    // A few lines of drift are known (ConPTY's repaint for the taller size); the reported bug was
    // hundreds of lines.
    check(
      b.viewportY < b.baseY && Math.abs(num(top()) - num(was)) <= 5,
      'a screen scrolled up keeps its place (within 5 lines) through larger and back (' +
        JSON.stringify(was) +
        ' → ' +
        JSON.stringify(atMax) +
        ' → ' +
        JSON.stringify(top()) +
        ')'
    );
    t.scrollToBottom();
    await frames(5);
  }

  // (c) real wheel notches over the screen with mouse reporting on: lines per notch, and back down
  // reaches the newest output.
  {
    const t = termOf(A),
      b = t.buffer.active,
      r = t.element.querySelector('.xterm-screen').getBoundingClientRect(),
      x = r.left + r.width / 2,
      y = r.top + r.height / 2;
    await main('move', x, y);
    await wait(100);
    const y0 = b.viewportY,
      steps = [];
    for (let i = 0; i < 3; i++) {
      await main('wheel', x, y, 1);
      await frames(3);
      steps.push(b.baseY - b.viewportY);
    }
    note(
      'wheel up 3 notches, mouse reporting on, ' +
        t.options.fontSize +
        ' px: lines above the bottom after each notch ' +
        steps.join(', ')
    );
    const perNotch = steps[0];
    check(
      perNotch > 0 && perNotch <= 12 && steps[2] <= perNotch * 3 + 1,
      'wheel up moves a few lines per notch, no double scroll (' + steps.join(', ') + ')'
    );

    // Output while scrolled up: the view keeps its place.
    const top = b.getLine(b.viewportY)?.translateToString(true).trim();
    await print([A], 'W', 50);
    check(
      b.getLine(b.viewportY)?.translateToString(true).trim() === top,
      'output while scrolled up keeps the view on the same line (' + JSON.stringify(top) + ')'
    );
    for (let i = 0; i < 40 && b.viewportY < b.baseY; i++) {
      await main('wheel', x, y, -1);
      await frames(2);
    }
    check(b.viewportY === b.baseY, 'wheel down reaches the newest output (' + st(A) + ')');
    await print([A], 'W2', 30);
    check(st(A) === 'B', 'new output followed after wheeling back down (' + st(A) + ')');
    void y0;
  }

  // (a) compact: the CLI clears the screen and the scrollback, then draws the conversation again
  // (longer than the screen).
  const clears = {
    'ED2+ED3+home': E + '[2J' + E + '[3J' + E + '[H',
    'ED2+home (Windows clearTerminal)': E + '[2J' + E + '[0f',
    'home+ED0+ED3': E + '[H' + E + '[0J' + E + '[3J',
  };
  let i = 0;
  for (const [name, seq] of Object.entries(clears)) {
    const cmd = windows
      ? '[Console]::Write("' +
        seq.replace(/\\x1b/g, '$([char]27)') +
        '"); 1..400 | % { "C' +
        i +
        ' $_" }'
      : 'printf "' + seq + '"; for i in $(seq 1 400); do echo "C' + i + ' $i"; done';
    await run(all, 'C' + i, cmd);
    const s = await frames(10);
    check(state() === 'B', 'compact (' + name + '): at the newest output (' + s + ')');
    note('after ' + name + ': buffer lines ' + termOf(A).buffer.active.length);
    i++;
  }

  // Scrolled up a little when the CLI clears its scrollback and draws everything again (a compact,
  // or Claude Code's full redraw of a tall live area): the spot the user was on is gone, so the
  // view follows the new output instead of staying at the top of the redraw.
  {
    const t = termOf(A),
      b = t.buffer.active;
    t.scrollLines(-15);
    await frames(3);
    const cmd = windows
      ? '[Console]::Write("$([char]27)[2J$([char]27)[3J$([char]27)[H"); 1..400 | % { "CU $_" }'
      : 'printf "\\x1b[2J\\x1b[3J\\x1b[H"; for i in $(seq 1 400); do echo "CU $i"; done';
    await run([A], 'CU', cmd);
    const s = await frames(10);
    check(
      st(A) === 'B',
      'compact while scrolled up a little: follows the redrawn output, not left at its top (' +
        s +
        ', top line ' +
        JSON.stringify(b.getLine(b.viewportY)?.translateToString(true).trim()) +
        ')'
    );
  }

  // Compact while the user had scrolled up a little and come back down with the wheel.
  {
    const t = termOf(A),
      b = t.buffer.active,
      r = t.element.querySelector('.xterm-screen').getBoundingClientRect(),
      x = r.left + r.width / 2,
      y = r.top + r.height / 2;
    await main('wheel', x, y, 1);
    await frames(3);
    await main('wheel', x, y, -1);
    await frames(3);
    note('after one notch up and one down: ' + st(A));
    const cmd = windows
      ? '[Console]::Write("$([char]27)[2J$([char]27)[3J$([char]27)[H"); 1..400 | % { "CW $_" }'
      : 'printf "\\x1b[2J\\x1b[3J\\x1b[H"; for i in $(seq 1 400); do echo "CW $i"; done';
    await run([A], 'CW', cmd);
    const s = await frames(10);
    check(st(A) === 'B', 'compact after a wheel up and down: at the newest output (' + s + ')');
  }

  // (b) with a CLI that redraws everything when its size changes (Claude Code's normal-screen
  // renderer clears the screen and the scrollback and prints the conversation again): larger and
  // back at the newest output, three rounds.
  if (windows) {
    const t = termOf(A);
    t.scrollToBottom();
    await frames(3);
    let n = 0;
    agents.send(
      A.dataset.paneId,
      '$e=[char]27; $w=[Console]::WindowWidth; $h=[Console]::WindowHeight; $n=0; while ($true) { if ([Console]::WindowWidth -ne $w -or [Console]::WindowHeight -ne $h) { $w=[Console]::WindowWidth; $h=[Console]::WindowHeight; $n++; [Console]::Write("$e[2J$e[3J$e[H"); 1..600 | % { "R$n $_" }; "REDRAWN$n" }; Start-Sleep -Milliseconds 50 }'
    );
    await wait(1500);
    const redrawn = async () => {
      n++;
      return until(
        async () => (await buffer(A.dataset.paneId)).includes('REDRAWN' + n + '\r'),
        8000
      );
    };
    for (let r = 0; r < 3; r++) {
      await bigger();
      const got = await redrawn();
      const m = await frames(10);
      check(
        got && st(A) === 'B',
        'redraw on resize, round ' + (r + 1) + ': made larger, at the newest output (' + m + ')'
      );
      await smaller();
      const got2 = await redrawn();
      const s = await frames(10);
      check(
        got2 && st(A) === 'B',
        'redraw on resize, round ' +
          (r + 1) +
          ': back at its size, at the newest output (' +
          s +
          ')'
      );
    }
    t.input('\x03');
    await wait(300);
  }
  all.forEach(p => agents.stop?.(p.dataset.paneId));
} catch (e) {
  check(false, 'threw: ' + (e.stack || e.message));
}
window.Terminal = RealTerminal;
return { ok, log };
