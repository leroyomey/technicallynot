/*
 * Technically Not tools · desktop-check/tests/cli-screen-capture.js — The terminal screen capture
 * (110-terminal-capture.js) for the "rows vanish from the middle of a reply" bug. Capture: a
 * PowerShell thread prints 30 numbered rows, the CLI screen of its thread (120, the terminal a
 * user sees now) is made 3 rows shorter and back (as a view losing rows does), the capture key is
 * pressed in that terminal; the keys must not reach the
 * terminal, one toast names the folder, and the folder under userData\captures holds screen.txt
 * (every row), visible.txt (the rows on screen), pty-tail.log (raw output with size notes) and
 * capture.json (pane, CLI, view and pty size, the size changes just made, timestamps). Then the
 * saved output is replayed the way the compare tool does and must give the same rows as the screen.
 * Compare mode (TNAI_CAPTURE = a capture folder, set by tools/terminal-capture-compare.js): only
 * replays that folder's output in the app's terminal and a plain xterm and writes replay-app.txt
 * and replay-plain.txt. Returns {ok, log}.
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
    await wait(100);
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
const native = window.tnaiNative,
  agents = window.TnaiAgents,
  mac = !!window.tnaiPlatform?.mac;
const hosts = [];
const textOf = term => {
  const b = term.buffer.active,
    out = [];
  for (let y = 0; y < b.length; y++) out.push(b.getLine(y)?.translateToString(true) ?? '');
  return out.join('\n');
};
const writeTo = (term, s) => new Promise(r => term.write(s, r));

// The saved output replayed at the captured view's size: in the app's own terminal (createTerm,
// size notes followed) and in a plain xterm.
async function replayBoth(text, view) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:800px;z-index:-1';
  document.body.append(host);
  hosts.push(host);
  const made = await agents.createTerm();
  made.term.open(host);
  made.term.resize(view.cols, view.rows);
  await made.replay(text);
  await wait(300);
  if (made.term.cols !== view.cols || made.term.rows !== view.rows) {
    note(
      'app replay ended at ' +
        made.term.cols +
        '×' +
        made.term.rows +
        ', resized to the view size ' +
        view.cols +
        '×' +
        view.rows
    );
    made.term.resize(view.cols, view.rows);
    await wait(150);
  }
  const appText = textOf(made.term);
  made.term.dispose();
  const host2 = document.createElement('div');
  host2.style.cssText = host.style.cssText;
  document.body.append(host2);
  hosts.push(host2);
  const plain = new window.Terminal({
    cols: view.cols,
    rows: view.rows,
    scrollback: 5000,
    allowProposedApi: true,
    ...(native.windowsBuild
      ? { windowsPty: { backend: 'conpty', buildNumber: native.windowsBuild } }
      : {}),
  });
  plain.open(host2);
  for (const part of String(text).split(/(?=\x1b\]7717;\d+;\d+\x07)/)) {
    const m = part.match(/^\x1b\]7717;(\d+);(\d+)\x07/);
    if (m) plain.resize(+m[1], +m[2]);
    await writeTo(plain, m ? part.slice(m[0].length) : part);
  }
  if (plain.cols !== view.cols || plain.rows !== view.rows) plain.resize(view.cols, view.rows);
  await wait(150);
  const plainText = textOf(plain);
  plain.dispose();
  return { appText, plainText };
}

try {
  const folder = await main('mode');
  if (folder) {
    // Compare mode: replay a capture the user made.
    const cap = await main('load', folder);
    check(
      !!cap.meta && cap.log !== null && cap.screen !== null,
      'the capture folder has capture.json, pty-tail.log and screen.txt (' + folder + ')'
    );
    const view = cap.meta?.views?.[0] || {
      cols: cap.meta?.pty?.cols || 120,
      rows: cap.meta?.pty?.rows || 30,
    };
    const r = await replayBoth(cap.log || '', view);
    note(
      'written: ' +
        (await main('writeReplay', folder, 'replay-app.txt', r.appText)) +
        ', ' +
        (await main('writeReplay', folder, 'replay-plain.txt', r.plainText))
    );
    const d = await main('diff', folder, r.appText);
    note(
      'screen against the app replay, last ' +
        d.rows +
        ' rows: ' +
        d.differ +
        ' rows differ (the compare tool prints them)'
    );
  } else {
    // Capture mode.
    check(
      !!native?.pty?.capture && !!window.TnaiTerminalCapture,
      'the capture bridge and window.TnaiTerminalCapture are loaded'
    );
    check(
      !!window.TnaiShortcuts?.list().some(x => /Rows missing from a reply/.test(x.what)),
      'the shortcut list names the capture key'
    );
    const said = [],
      toast0 = window.toast;
    window.toast = t => {
      said.push(String(t));
      return toast0?.(t);
    };
    const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
    const paneId = started.paneId;
    check(!!started.session?.running, 'PowerShell started as a thread');
    await wait(1500);
    agents.send(paneId, '1..30 | ForEach-Object { "CAPTURE-ROW-$_" }');
    check(
      !!(await until(async () =>
        /CAPTURE-ROW-30/.test((await native.pty.replay(paneId))?.buffer || '')
      )),
      'the shell printed 30 numbered rows'
    );

    // its thread: a PowerShell thread has no conversation, so it opens on its screen
    window.TnaiThreads.show(paneId);
    await until(() => window.TnaiThreadView.shown() === paneId, 8000);
    if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
    const view = await until(() =>
      agents
        .views()
        .find(
          v =>
            v.paneId === paneId &&
            v.where === 'Thread CLI screen' &&
            v.term === window.TnaiThreadView.term() &&
            v.term.element?.getClientRects().length &&
            /CAPTURE-ROW-30/.test(textOf(v.term))
        )
    );
    check(
      !!view,
      'the CLI screen of its thread shows them, and the app names it "Thread CLI screen"'
    );

    // the screen has set the session's size once it has been still for a moment
    await until(() => {
      const now = agents.ptySize.get(paneId);
      return !!now && now.cols === view.term.cols && now.rows === view.term.rows;
    }, 6000);
    await wait(700);
    const t = view.term,
      cols = t.cols,
      rows = t.rows;

    // A view losing three rows and getting them back: the size history must hold both, for the view
    // and for the pty. The screen's box is made three rows lower and the terminals are refitted,
    // as a lower window does.
    const screenBox = window.TnaiThreads.slot('main').querySelector('.tnt-term');
    const refit = () => window.dispatchEvent(new CustomEvent('tnai:terminal-font', { detail: {} }));
    const rowHeight =
      t.element.querySelector('.xterm-screen').getBoundingClientRect().height / rows;
    screenBox.style.height =
      Math.round(screenBox.getBoundingClientRect().height - 3 * rowHeight) + 'px';
    screenBox.style.flex = 'none';
    refit();
    await until(() => t.rows === rows - 3, 3000);
    await wait(600);
    screenBox.style.height = '';
    screenBox.style.flex = '';
    refit();
    await until(() => t.rows === rows, 3000);
    await wait(600);
    const hist = agents.sizeHistory(paneId),
      has = (kind, r) => hist.some(h => h.kind === kind && h.cols === cols && h.rows === r);
    check(
      has('view', rows - 3) &&
        has('view', rows) &&
        has('pty', rows - 3) &&
        has('pty', rows) &&
        hist.some(h => h.kind === 'pty-start'),
      'the size history holds the start, the view and pty going to ' +
        (rows - 3) +
        ' rows and back to ' +
        rows +
        ' (' +
        hist.map(h => h.kind + ' ' + h.cols + '×' + h.rows).join(', ') +
        ')'
    );
    await wait(800);
    t.focus();
    t.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await wait(100);
    let reached = false;
    t.textarea?.addEventListener(
      'keydown',
      () => {
        reached = true;
      },
      { once: true }
    );
    const key = new KeyboardEvent('keydown', {
      code: 'KeyC',
      key: 'C',
      ctrlKey: !mac,
      metaKey: mac,
      shiftKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    (t.textarea || document.body).dispatchEvent(key);
    check(
      key.defaultPrevented && !reached,
      'the capture key is taken before the terminal gets it (prevented: ' +
        key.defaultPrevented +
        ', reached the terminal: ' +
        reached +
        ')'
    );
    const line = await until(
      () => said.find(s => /^Terminal screen (saved|not saved)/.test(s)),
      20000
    );
    check(
      !!line && line.startsWith('Terminal screen saved: '),
      'one toast says where it was saved (' + (line || 'no toast') + ')'
    );
    const dir = line?.replace(/^Terminal screen saved: /, '') || '';
    const cap = dir ? await main('load', dir) : null,
      meta = cap?.meta,
      v0 = meta?.views?.[0];
    check(
      !!cap?.inCaptures && /\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_/.test(dir.split(/[\\/]/).pop() || ''),
      'the folder is dated and under userData\\captures (' + dir.split(/[\\/]/).pop() + ')'
    );
    check(
      ['screen.txt', 'visible.txt', 'pty-tail.log', 'capture.json'].every(f =>
        cap?.files.includes(f)
      ),
      'it holds screen.txt, visible.txt, pty-tail.log and capture.json (' +
        (cap?.files || []).join(', ') +
        ')'
    );
    check(
      Array.from({ length: 30 }, (_, i) => 'CAPTURE-ROW-' + (i + 1)).every(w =>
        new RegExp('^' + w + '$', 'm').test(cap?.screen || '')
      ),
      'screen.txt has all 30 rows the shell printed'
    );
    check(
      /CAPTURE-ROW-30/.test(cap?.visible || '') && (cap?.visible || '').split('\n').length <= rows,
      'visible.txt has the newest rows and no more rows than the screen (' +
        (cap?.visible || '').split('\n').length +
        ' of ' +
        rows +
        ')'
    );
    check(
      /CAPTURE-ROW-30/.test(cap?.log || '') && /\x1b\]7717;\d+;\d+\x07/.test(cap?.log || ''),
      'pty-tail.log holds the raw output with its size notes'
    );
    check(
      meta?.paneId === paneId &&
        meta?.cli === 'Terminal' &&
        v0?.where === 'Thread CLI screen' &&
        v0?.cols === cols &&
        v0?.rows === rows &&
        meta?.pty?.cols === cols &&
        meta?.pty?.rows === rows,
      'capture.json names the panel, the CLI, the view and the pty size (' +
        meta?.cli +
        ', ' +
        v0?.where +
        ' ' +
        v0?.cols +
        '×' +
        v0?.rows +
        ', pty ' +
        meta?.pty?.cols +
        '×' +
        meta?.pty?.rows +
        ')'
    );
    check(
      Array.isArray(meta?.sizeHistory) &&
        meta.sizeHistory.some(h => h.kind === 'pty' && h.rows === rows - 3) &&
        !!Date.parse(meta?.capturedAt) &&
        !!meta?.capturedLocal &&
        !!meta?.app,
      'capture.json has the size changes, the capture time (' +
        meta?.capturedLocal +
        ') and the app version (' +
        meta?.app +
        ')'
    );

    // The compare tool's replay of this capture gives the same rows as the screen.
    const r = await replayBoth(cap?.log || '', v0 || { cols, rows });
    await main('writeReplay', dir, 'replay-app.txt', r.appText);
    await main('writeReplay', dir, 'replay-plain.txt', r.plainText);
    const d = await main('diff', dir, r.appText);
    check(
      d.differ === 0,
      'a replay of the saved output matches the captured screen (' +
        d.differ +
        ' of the last ' +
        d.rows +
        ' rows differ)'
    );
    if (d.differ) d.lines.forEach(note);
    window.toast = toast0;
    await agents.stop(paneId);
    check(
      !!(await until(() => !agents.sessions().find(s => s.paneId === paneId && s.running), 8000)),
      'Stop ended the shell'
    );
  }
} catch (e) {
  check(false, 'threw: ' + (e.stack || e.message));
}
hosts.forEach(h => h.remove());
return { ok, log };
