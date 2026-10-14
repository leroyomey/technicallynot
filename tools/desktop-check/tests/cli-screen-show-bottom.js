/*
 * Technically Not tools · desktop-check/tests/cli-screen-show-bottom.js — A thread's CLI screen
 * (120) is at the newest output when it is shown again. One real PowerShell thread on the GPU
 * (WebGL) renderer prints while something else is shown (the All threads page, the Skills page,
 * another thread), with a full scrollback (5000 lines) and Technically Not's window resized,
 * maximized or restored meanwhile, then while output streams across quick switches. xterm resized
 * a shown-again terminal before it un-paused drawing, its viewport kept the old scroll range, and
 * the view sat a row or more up for good (new output no longer followed); it was a race, so the
 * window changes repeat. It was written for three terminal panels on the Terminal page and walked
 * the old Overview and the Agents page; the terminal a user sees now is the CLI screen.
 * A screen the user scrolled up comes back at the same line when nothing was printed while it
 * was away, and at the newest line when something was (120 `reshow`).
 * No agent CLI, no prompt. Window control: terminal-fit.main.js. Returns {ok, log}.
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

// The real renderer: the race shows with WebGL (run.js turns on the DOM renderer for other tests
// before this runs).
window.__tnaiDomRenderer = false;
try {
  localStorage.removeItem('tnai.test.dom-renderer');
} catch {}
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const view = () => window.TnaiThreadView;

// the thread's shell: PowerShell on Windows, bash elsewhere
const windows = /Windows/.test(navigator.userAgent);
const buffer = async id => (await window.tnaiNative.pty.replay(id))?.buffer || '';
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const started = [];
try {
  await agents.detect(true);
  threads.open();
  await until(() => threads.visible(), 5000);
  const first = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  const other = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  started.push(first, other);
  for (const id of started)
    await until(async () => (windows ? /PS [A-Z]:/ : /[$#] $/m).test(await buffer(id)), 15000);

  // The CLI screen of the first thread. A PowerShell thread has no conversation, so it opens on
  // its screen; the test waits until that terminal is the one shown.
  const cliTerm = () => {
    const term = view().term();
    return view().shown() === first &&
      term?.tnaiPaneId === first &&
      term.element?.getClientRects().length
      ? term
      : null;
  };
  const showFirst = () => {
    threads.show(first);
    if (view().mode() !== 'term') view().setMode('term');
  };
  showFirst();
  const term = await until(cliTerm, 10000);
  check(
    !!term && !!term.element.querySelector('canvas'),
    'a PowerShell thread shows its CLI screen on the WebGL renderer'
  );
  if (!term) throw new Error('no CLI screen for the thread');

  // What is shown instead of the thread for a while.
  const away = {
    'All threads': () => window.TnaiTest.openAllThreads(),
    Skills: () => window.TnaiRoute('skills'),
    'another thread': () => threads.show(other),
  };

  // B at the newest line, U<n> n lines above it. The terminal of a thread is kept while another
  // of the last three is shown (120), so it is the same one when it comes back; one made anew
  // counts just the same.
  const state = () => {
    const now = cliTerm();
    const lines = now?.buffer.active;
    if (!lines) return '?';
    return lines.viewportY === lines.baseY ? 'B' : 'U' + (lines.baseY - lines.viewportY);
  };
  const print = async (tag, count) => {
    agents.send(
      first,
      windows
        ? '1..' + count + ' | % { "' + tag + ' $_" }; "' + tag + 'DONE"'
        : 'for i in $(seq 1 ' +
            count +
            '); do echo "' +
            tag +
            ' $i"; done; echo "' +
            tag +
            '""DONE"'
    );
    await until(async () => (await buffer(first)).includes(tag + 'DONE\r'), 20000);
    await wait(400);
  };
  const shown = async label => {
    showFirst();
    const seen = [];
    for (let i = 0; i < 20; i++) {
      await frame();
      seen.push(state());
    }
    await until(() => state() !== '?', 6000);
    await wait(600);
    seen.push(state());
    check(
      state() === 'B',
      label + ': the CLI screen is at the newest output (per frame: ' + seen.join(' ') + ')'
    );
  };
  await main('setSize', 1300, 850);
  await wait(400);
  const rounds = [
    ['All threads', 5200, ['setSize', 1000, 700]],
    ['Skills', 200, ['setSize', 1400, 900]],
    ['another thread', 200, ['maximize']],
    ['All threads', 200, ['unmaximize']],
    ['another thread', 200, ['setSize', 900, 650]],
    ['Skills', 200, ['maximize']],
    ['another thread', 200, ['setSize', 1300, 850]],
    ['All threads', 200, ['maximize']],
    ['Skills', 200, ['unmaximize']],
  ];
  for (const [i, [where, count, size]] of rounds.entries()) {
    away[where]();
    await wait(300);
    await print('R' + i, count);
    await main(...size);
    await wait(400);
    await shown(
      'round ' + (i + 1) + ': ' + count + ' lines behind ' + where + ', window ' + size.join(' ')
    );
    await print('R' + i + 'F', 40);
    check(state() === 'B', 'round ' + (i + 1) + ': new output still followed (' + state() + ')');
  }

  // Streaming output across quick switches.
  agents.send(
    first,
    windows
      ? '1..200 | % { "S $_"; Start-Sleep -Milliseconds 30 }; "SDONE"'
      : 'for i in $(seq 1 200); do echo "S $i"; sleep 0.03; done; echo "S""DONE"'
  );
  const places = Object.keys(away);
  for (let r = 0; r < 4; r++) {
    away[places[r % places.length]]();
    await wait(400 + r * 150);
    await shown('streaming switch ' + (r + 1) + ' (back from ' + places[r % places.length] + ')');
  }
  await until(async () => (await buffer(first)).includes('SDONE\r'), 15000);
  await wait(500);
  check(
    state() === 'B',
    'after the stream ended the CLI screen is at its last line (' + state() + ')'
  );

  // Scrolled up by the user, nothing printed meanwhile: back at the same line. Tried from the
  // Skills page and from another thread, twice each. Not from All threads: this test runs with
  // that page as the plain grid of panels, where the session's own panel shows and resizes it,
  // and the shell paints its screen again for the new size, which is output.
  {
    cliTerm().scrollLines(-40);
    await wait(300);
    const lines = () => cliTerm()?.buffer.active;
    const topText = () => lines()?.getLine(lines().viewportY)?.translateToString(true) || '';
    const top = topText();
    check(
      !!top && lines().baseY - lines().viewportY >= 40,
      'the user scrolled the screen 40 lines up (top line ' + JSON.stringify(top) + ')'
    );
    for (const where of ['Skills', 'another thread', 'Skills', 'another thread']) {
      away[where]();
      await wait(500);
      showFirst();
      await until(cliTerm, 6000);
      for (let i = 0; i < 20; i++) await frame();
      await wait(700);
      check(
        topText() === top && lines().viewportY < lines().baseY,
        'back from ' +
          where +
          ' with nothing printed meanwhile: the same line at its top (' +
          JSON.stringify(topText()) +
          ', ' +
          state() +
          ')'
      );
    }

    // Still scrolled up, and now output arrives while it is away: back at the newest line.
    away['another thread']();
    await wait(400);
    await print('U', 30);
    await shown('scrolled up, then 30 lines printed while another thread was shown');
    cliTerm().scrollLines(-40);
    await wait(300);
    away['All threads']();
    await wait(400);
    await print('V', 30);
    await shown('scrolled up, then 30 lines printed behind All threads');
  }
} catch (e) {
  check(false, 'threw: ' + (e.stack || e.message));
}
for (const id of started) if (id) await agents.stop?.(id);
await main('unmaximize').catch(() => {});
return { ok, log };
