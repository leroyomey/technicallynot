/*
 * Technically Not tools · desktop-check/tests/powershell-link-speed.js — how long a click on a
 * "PS> command" link (90) takes, step by step (a terminal should load at once, and it took far
 * too long). Times, from the click: the All threads page shown (where the click lands), the new
 * thread's card on it, its session starting, PowerShell running (pty:start answered), its first
 * output, its first prompt, the command arriving, the command's output; then the same click
 * with an idle PowerShell panel open (the command goes to that panel). The opened panels are
 * real PowerShell processes, stopped at the end. Windows only. Fails when the panel is not on
 * screen within PANEL_MS of the click. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000, step = 100) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(step);
  }
  return null;
};
const native = window.tnaiNative,
  agents = window.TnaiAgents;
const ANSI =
  /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g;

// the new thread is on the page: as a panel of the old Terminal page it took 315 to 346 ms before
// the fixed waits were removed (2026-10-03), 110 to 270 after, on a busy PC
const PANEL_MS = 300;
const started = [];
const box = document.createElement('div');
box.style.cssText =
  'position:fixed;left:0;top:0;width:900px;height:240px;z-index:9999;background:#fff';
document.body.append(box);
try {
  const { term, fit } = await agents.createTerm();
  term.open(box);
  fit.fit();
  await wait(150);
  const screen = term.element.querySelector('.xterm-screen');
  const cellAt = (col, row) => {
    const r = screen.getBoundingClientRect();
    return {
      clientX: r.left + ((col + 0.5) * r.width) / term.cols,
      clientY: r.top + ((row + 0.5) * r.height) / term.rows,
    };
  };
  const mouse = (type, at) =>
    screen.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === 'mousedown' ? 1 : 0,
        ...at,
      })
    );
  const findText = s => {
    const b = term.buffer.active;
    for (let y = 0; y < b.length; y++) {
      const x = b.getLine(y)?.translateToString(true).indexOf(s) ?? -1;
      if (x >= 0) return { x, y: y - b.viewportY };
    }
    return null;
  };
  const pointer = () =>
    term.element.classList.contains('xterm-cursor-pointer') ||
    !!term.element.querySelector('.xterm-cursor-pointer');
  const cmdOf = tag => "echo ('" + tag.slice(0, 4) + "'+'" + tag.slice(4) + "')";
  const ms = v => (v === undefined ? '   -' : String(Math.round(v)).padStart(4));

  // One click on a PS> line; marks are ms after the click. reuse: the idle panel expected to take
  // the command.
  const clickCase = async (name, tag, reuse) => {
    term.reset();
    fit.fit();
    await new Promise(r => term.write('  Run this:\r\n\r\n    PS> ' + cmdOf(tag) + '\r\n\r\n', r));
    await wait(100);
    let h = null;
    for (let i = 0; i < 4 && !(h && pointer()); i++) {
      mouse('mouseleave', cellAt(0, 0));
      mouse('mousemove', cellAt(term.cols - 1, term.rows - 1));
      await wait(150);
      const p = findText("echo ('" + tag.slice(0, 4));
      h = p && cellAt(p.x + 2 + i, p.y);
      if (h) {
        mouse('mousemove', h);
        await wait(300);
      }
    }
    if (!h || !pointer()) {
      check(false, name + ': the command is a link');
      return null;
    }
    const seen = new Set(agents.sessions().map(s => s.paneId)),
      cardsBefore = new Set(
        [...document.querySelectorAll('.tat-card[data-pane]')].map(one => one.dataset.pane)
      );
    const m = {},
      tails = new Map();
    let id = reuse?.paneId || '';
    const mark = k => {
      if (m[k] === undefined) m[k] = performance.now() - t0;
    };
    const off = native.pty.onData(({ paneId, data }) => {
      if (seen.has(paneId) && paneId !== id) return;
      const t = ((tails.get(paneId) || '') + String(data).replace(ANSI, '')).slice(-4000);
      tails.set(paneId, t);
      if (!reuse) {
        mark('output');
        if (/>\s*$/.test(t)) mark('prompt');
      }
      if (t.includes("echo ('" + tag.slice(0, 4))) mark('typed');
      if (t.split(/\r?\n/).some(l => l.trim() === tag)) mark('ran');
    });
    const tick = setInterval(() => {
      if (!reuse) {
        // what a user sees of the new session: its card on All threads, where the click lands
        const card = [...document.querySelectorAll('.tat-card[data-pane]')].find(
          one => !cardsBefore.has(one.dataset.pane) && one.getClientRects().length > 0
        );
        if (card) mark('panel');
        const s = agents.sessions().find(x => !seen.has(x.paneId) && x.agent === 'Terminal');
        if (s) {
          id = s.paneId;
          mark('session');
          if (s.running) mark('running');
        }
      }
      if (document.querySelector('.layout.terminal-mode.tat-on')) mark('page');
    }, 4);

    // How long each scripted press inside the app's own open path holds the page (nav, picker
    // button, picker card), and the frames it cost.
    const presses = [],
      realClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
      const a = performance.now();
      try {
        return realClick.call(this);
      } finally {
        presses.push(
          (this.id ||
            this.dataset?.view ||
            this.dataset?.provider ||
            this.className ||
            this.tagName) +
            ' ' +
            Math.round(performance.now() - a)
        );
      }
    };
    const hostObs = new MutationObserver(() => {
      if (document.querySelector('.terminal-pane:not([data-seen-speed]) .tnai-xterm'))
        mark('xterm');
    });
    document.querySelectorAll('.terminal-pane').forEach(p => p.setAttribute('data-seen-speed', ''));
    hostObs.observe(document.body, { childList: true, subtree: true });
    const realSend = agents.send;
    agents.send = function (...a) {
      mark('sent');
      return realSend.apply(this, a);
    };
    const t0 = performance.now();
    mouse('mousedown', h);
    mouse('mouseup', h);
    mouse('click', h);
    mark('clickReturned');
    until(() => m.ran !== undefined, 20000, 20).then(() => {
      agents.send = realSend;
    });
    await until(() => m.ran !== undefined, 20000, 20);
    clearInterval(tick);
    off();
    hostObs.disconnect();
    HTMLElement.prototype.click = realClick;
    log.push(
      '     ' +
        name.padEnd(22) +
        ' click handler returned' +
        ms(m.clickReturned) +
        '  terminal box in panel' +
        ms(m.xterm) +
        '  presses (ms each): ' +
        presses.join(', ')
    );
    if (id && !reuse) started.push(id);
    log.push(
      '     ' +
        name.padEnd(22) +
        ' page' +
        ms(m.page) +
        '  card' +
        ms(m.panel) +
        '  session' +
        ms(m.session) +
        '  running' +
        ms(m.running) +
        '  output' +
        ms(m.output) +
        '  prompt' +
        ms(m.prompt) +
        '  sent' +
        ms(m.sent) +
        '  typed' +
        ms(m.typed) +
        '  ran' +
        ms(m.ran) +
        '  (ms after the click)'
    );
    check(m.ran !== undefined, name + ': the command ran');
    if (reuse) {
      const extra = agents.sessions().filter(s => s.agent === 'Terminal' && !seen.has(s.paneId));
      extra.forEach(s => started.push(s.paneId));
      check(
        !extra.length,
        name + ': the idle panel took the command, no new panel opened (' + extra.length + ' new)'
      );
    }
    return { m, paneId: id };
  };

  log.push('     window hidden: ' + document.hidden + ', focused: ' + document.hasFocus());
  const theme = window.TnaiTheme?.resolved?.() || 'light';
  const rootRes = await native.fs.root(),
    root = String(typeof rootRes === 'string' ? rootRes : rootRes?.value || '')
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  window.TnaiSettings?.set?.('readyShell', false);
  await wait(400); // the first clicks time a PowerShell that starts at the click
  check(
    (await native.pty.warm({ on: false, theme })) === false,
    'with the setting off no PowerShell is kept ready'
  );
  const runs = [];
  for (let i = 1; i <= 3; i++) {
    const r = await clickCase('new panel, click ' + i, 'NEWP' + 'RAN' + i);
    if (!r) break;
    runs.push(r.m);
    if (i < 3) {
      agents.send(r.paneId, 'Start-Sleep 60');
      await wait(800);
    } // busy, so the next click opens a panel of its own
    else {
      await wait(1800);
      const idle = await clickCase('idle panel', 'IDLE' + 'RAN1', { paneId: r.paneId });
      if (idle) {
        await wait(1800);
        await clickCase('idle panel, again', 'IDLE' + 'RAN2', { paneId: r.paneId });
      }
    }
  }

  // The same click with a PowerShell kept ready (Settings > Terminal, on by default): the panel
  // takes that one over, prompt already there.
  window.TnaiSettings?.set?.('readyShell', true);
  const readyRuns = [];
  for (let i = 1; i <= 2 && runs.length; i++) {
    for (const s of agents.sessions().filter(x => x.agent === 'Terminal' && x.running))
      // every panel busy: the click needs a panel of its own
      agents.send(s.paneId, 'Start-Sleep 60');
    const kept = await until(() => native.pty.warm({ on: true, theme }), 10000, 300);
    check(!!kept, 'ready PowerShell, click ' + i + ': one is kept ready');
    await wait(3000); // it reaches its first prompt
    const r = await clickCase('ready PowerShell, click ' + i, 'WARM' + 'RAN' + i);
    if (!r) break;
    readyRuns.push(r.m);
    const cwd = String(agents.sessions().find(x => x.paneId === r.paneId)?.cwd || '')
      .replace(/[\\/]+$/, '')
      .toLowerCase();
    check(
      !!root && cwd === root,
      'ready PowerShell, click ' + i + ': the panel works in the project folder (' + cwd + ')'
    );
  }
  if (readyRuns.length) {
    const cold = Math.min(...runs.map(m => m.ran ?? Infinity)),
      slowest = Math.max(...readyRuns.map(m => m.ran ?? Infinity));

    // The proof that the ready one was taken: its prompt is there the moment the panel's process is
    // (a PowerShell started at the click needs 400 to 650 ms more). The run times are printed, not
    // judged: about 0.2 s of them is PowerShell running its first command.
    const gap = Math.max(...readyRuns.map(m => (m.prompt ?? Infinity) - (m.running ?? 0))),
      coldGap = Math.min(...runs.map(m => (m.prompt ?? Infinity) - (m.running ?? 0)));
    check(
      gap <= 100,
      'with a ready PowerShell the prompt is there as the panel starts (' +
        Math.round(gap) +
        ' ms after; started at the click: ' +
        Math.round(coldGap) +
        ' ms at best)'
    );
    log.push(
      '     command run: ready ' +
        Math.round(slowest) +
        ' ms at the slowest, started at the click ' +
        Math.round(cold) +
        ' ms at best (ms after the click)'
    );
    check(
      readyRuns.every(m => m.sent !== undefined && m.prompt !== undefined && m.sent >= m.prompt),
      'ready PowerShell: the command is sent only after its prompt reached the panel'
    );
  }
  window.TnaiSettings?.set?.('readyShell', false);
  await wait(400);
  check(
    (await native.pty.warm({ on: false, theme })) === false,
    'turning the setting off ends the ready PowerShell'
  );

  // Its switch: Settings > Terminal, one row, showing the stored value.
  window.TnaiSettings?.open?.('terminal');
  await wait(500);
  const sw = document.querySelector('#settingsPage input[data-pref="readyShell"]');
  check(
    !!sw && !!sw.offsetParent && sw.checked === false,
    'Settings > Terminal shows the switch, off as just set (' +
      (sw ? 'checked ' + sw.checked + ', shown ' + !!sw.offsetParent : 'no switch') +
      ')'
  );
  box.style.display = 'none';
  await wait(100);
  console.log('TNAI_SHOT:settings-terminal');
  await wait(700);
  box.style.display = '';
  window.TnaiThreads.open();
  await wait(200);
  const worst = k =>
    // an empty panel underneath is filled first: the session stands for its card then
    Math.max(...runs.map(m => m[k] ?? (k === 'panel' ? m.session : undefined) ?? Infinity));
  if (runs.length) {
    check(
      worst('panel') <= PANEL_MS,
      'the new thread is on screen, as its card on All threads, within ' +
        PANEL_MS +
        ' ms of the click (slowest ' +
        Math.round(worst('panel')) +
        ' ms)'
    );
    check(
      runs.every(m => m.sent !== undefined && m.prompt !== undefined && m.sent >= m.prompt),
      'the command is sent only after the first prompt'
    );

    // The app's part ends at "sent"; PowerShell shows the command (typed) only once its own line
    // editor has loaded.
    check(
      runs.every(m => m.sent - m.prompt <= 40),
      'the command is sent within 40 ms of the first prompt (slowest ' +
        Math.round(Math.max(...runs.map(m => m.sent - m.prompt))) +
        ' ms)'
    );
  }
  term.dispose();
} catch (error) {
  check(false, 'threw: ' + error.message);
}
for (const id of started) await agents.stop(id).catch(() => {});
check(
  !!(await until(
    () => !agents.sessions().some(s => started.includes(s.paneId) && s.running),
    8000
  )),
  'opened PowerShell threads stopped'
);
box.remove();
return { ok, log };
