/*
 * Technically Not tools · desktop-check/tests/cli-screen-size-sync.js — The program of a thread
 * always has the size its CLI screen shows (the fault was empty rows under the CLI's input box).
 * A real PowerShell thread whose screen (120) is opened while the process is still starting (the
 * start is held open on the main side): the process was asked for with one size and the screen
 * shows another. Once it runs, PowerShell's own $Host.UI.RawUI.WindowSize must equal the screen's
 * cols × rows, and again after the screen's box got lower. Before the fix the size read after the
 * start was recorded as the pty's, so the real one was never sent. Returns {ok, log}.
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
const agents = window.TnaiAgents;
const windows = /Windows/.test(navigator.userAgent);
const buffer = async id => (await window.tnaiNative.pty.replay(id))?.buffer || '';
let seq = 0;

async function psSize(paneId) {
  const tag = 'SZ' + Date.now().toString(36) + ++seq + 'Q';
  agents.send(
    paneId,
    windows
      ? 'Write-Output ("' +
          tag +
          '" + $Host.UI.RawUI.WindowSize.Width + "x" + $Host.UI.RawUI.WindowSize.Height)'
      : 'echo "' + tag + '$(tput cols)x$(tput lines)"'
  );
  const re = new RegExp(tag + '(\\d+)x(\\d+)');
  const got = await until(async () => re.exec(await buffer(paneId)), 8000);
  return got ? { cols: +got[1], rows: +got[2] } : null;
}

try {
  await agents.detect(true);
  const view = window.TnaiThreadView;
  const known = new Set(agents.sessions().map(s => s.paneId));

  // The start is held open (main side), so the thread's screen is shown inside it: the process
  // was asked for with the size of its panel underneath, and the screen a user sees has another.
  await main('hold', 1500);
  const starting = window.TnaiTest.startThread({ tool: 'Terminal' });
  const asked = await until(() => main('asked'), 8000);
  check(!!asked, 'the start is on its way, held open: asked for ' + JSON.stringify(asked));
  const paneId = (await until(() => agents.sessions().find(s => !known.has(s.paneId)), 4000))
    ?.paneId;
  const shownWhileStarting =
    !!paneId &&
    !!(await until(() => window.TnaiThreads.show(paneId), 1000)) &&
    agents.sessions().find(s => s.paneId === paneId)?.running !== true;
  if (view.mode() !== 'term') view.setMode('term');
  log.push(
    'info the thread was ' +
      (shownWhileStarting ? '' : 'NOT ') +
      'opened while its process was still held'
  );
  await starting;
  check(
    !!agents.sessions().find(s => s.paneId === paneId && s.running),
    'PowerShell thread running'
  );
  await until(async () => (windows ? /PS [A-Z]:/ : /[$#] $/m).test(await buffer(paneId)), 8000);

  // ---- its CLI screen ----
  window.TnaiThreads.show(paneId);
  await until(() => view.shown() === paneId, 8000);
  if (view.mode() !== 'term') view.setMode('term');
  const cliBox = window.TnaiThreads.slot('main').querySelector('.tnt-term-box');
  const shownSize = () => {
    const term = view.term();
    return term?.tnaiPaneId === paneId && term.element?.getClientRects().length
      ? { cols: term.cols, rows: term.rows }
      : null;
  };
  check(!!(await until(shownSize, 10000)), 'its thread shows the CLI screen');

  // the screen sets the session's size once it has been still for a moment (10 and 120)
  const settled = async () => {
    await until(() => {
      const now = agents.ptySize.get(paneId);
      const size = shownSize();
      return !!now && !!size && now.cols === size.cols && now.rows === size.rows;
    }, 6000);
    await wait(900);
    return { screen: shownSize(), program: await psSize(paneId) };
  };
  const wide = await settled();
  check(
    !!asked &&
      !!wide.screen &&
      (asked.cols !== wide.screen.cols || asked.rows !== wide.screen.rows),
    'the screen has another size than the start asked for (' +
      JSON.stringify(asked) +
      ' → ' +
      JSON.stringify(wide.screen) +
      '), so the size was sent after the start'
  );
  check(
    !!wide.screen &&
      !!wide.program &&
      wide.program.cols === wide.screen.cols &&
      wide.program.rows === wide.screen.rows,
    'CLI screen: PowerShell has the size the screen shows (' +
      JSON.stringify(wide.program) +
      ' vs ' +
      JSON.stringify(wide.screen) +
      ')'
  );
  const term = cliBox.closest('.tnt-term');
  term.style.flex = 'none';
  term.style.height = Math.round(term.getBoundingClientRect().height * 0.6) + 'px';
  await until(() => (shownSize()?.rows || 99) < (wide.screen?.rows || 0), 6000);
  const low = await settled();
  check(
    !!low.screen && !!wide.screen && low.screen.rows < wide.screen.rows,
    'CLI screen: a lower box shows fewer rows (' +
      wide.screen?.rows +
      ' → ' +
      low.screen?.rows +
      ')'
  );
  check(
    !!low.program &&
      !!low.screen &&
      low.program.cols === low.screen.cols &&
      low.program.rows === low.screen.rows,
    'CLI screen: PowerShell has that size too (' +
      JSON.stringify(low.program) +
      ' vs ' +
      JSON.stringify(low.screen) +
      ')'
  );
  term.style.flex = '';
  term.style.height = '';
} catch (e) {
  ok = false;
  log.push('FAIL threw: ' + (e?.stack || e));
}
return { ok, log };
