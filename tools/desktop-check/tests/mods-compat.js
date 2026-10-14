// Technically Not tools · desktop-check/tests/mods-compat.js — Compatibility check for Claude Code
// mods: a real Claude Code thread started with function hooks on
// (run it as `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 node tools/desktop-check/check.js mods-compat`),
// then the built-in mod `/diff` is opened and closed on its CLI screen. Reports what it shows and
// whether Technically Not's reading of the thread (status, size, tail) holds while the mod is open
// and after it closes. No prompt is sent to the model. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const info = label => log.push('info ' + label);
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(150);
  }
  return null;
};
const G = window.TnaiAgents,
  N = window.tnaiNative;
const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
let pane;
try {
  await N.fs.write('notes.txt', new TextEncoder().encode('one\n'));

  // /diff needs a git repository with an uncommitted change: made in a PowerShell thread of the
  // temp project.
  const sh = await window.TnaiTest.startThread({ tool: 'Terminal' });
  await wait(2500);
  G.send(
    sh.paneId,
    "git init -q; git add -A; git -c user.email=t@t.test -c user.name=t commit -qm base; Add-Content notes.txt 'two'; echo GITREADY"
  );
  await until(
    async () =>
      /GITREADY\s*[\r\n]/.test(
        strip((await N.pty.replay(sh.paneId))?.buffer || '')
          .split('echo GITREADY')
          .pop() || ''
      ),
    15000
  );
  const cc = await window.TnaiTest.startThread({ tool: 'Claude Code', mode: 'run' });
  pane = cc.paneId;
  const view = window.TnaiThreadView;
  const plain = async () => strip((await N.pty.replay(pane))?.buffer || '');

  // the rows on the thread's CLI screen, read from the terminal itself
  const rows = () => {
    const term = view.shown() === pane ? view.term() : null;
    if (!term) return [];
    const buffer = term.buffer.active;
    const found = [];
    for (let row = 0; row < term.rows; row++)
      found.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '');
    return found;
  };
  const screen = () => rows().filter(Boolean).join('\n');
  const me = () => G.sessions().find(s => s.paneId === pane) || {};
  const size = () => JSON.stringify(G.ptySize.get(pane) || null);
  check(
    !!(await until(async () => /for shortcuts|Try "|trust/i.test(await plain()), 30000)),
    'Claude Code started as a thread'
  );
  await wait(1500);
  if (/trust/.test(await plain())) {
    N.pty.write(pane, '\x1b[B');
    await wait(800);
    N.pty.write(pane, '\r');
    await wait(4000);
  }

  // its thread, on its CLI screen
  window.TnaiThreads.show(pane);
  await until(() => view.shown() === pane, 6000);
  if (view.mode() !== 'term') view.setMode('term');
  check(
    !!(await until(() => view.term()?.element?.getClientRects().length, 8000)),
    'its thread shows the CLI screen'
  );
  await wait(1200);
  const before = {
    status: me().status,
    size: size(),
    lines: rows().filter(Boolean).length,
    cols: Math.max(...rows().map(r => r.length)),
  };
  info(
    'before /diff: status "' +
      before.status +
      '", size ' +
      before.size +
      ', ' +
      before.lines +
      ' lines, widest ' +
      before.cols
  );
  console.log('TNAI_SHOT:mods-compat-before');
  await wait(600);

  // The built-in pane mod.
  N.pty.write(pane, '/diff');
  await wait(900);
  N.pty.write(pane, '\r');
  const opened = await until(
    () =>
      /diff|uncommitted|No changes|not a git|changes/i.test(
        screen().split('\n').slice(-30).join('\n')
      ) &&
      !/^.*\/diff\s*$/m.test(rows().filter(Boolean).pop() || '') &&
      screen(),
    12000
  );
  await wait(1500);
  const during = { status: me().status, size: size(), text: screen() };
  info('after /diff: status "' + during.status + '", size ' + during.size);
  info(
    'screen (last 14 lines): ' +
      during.text
        .split('\n')
        .slice(-14)
        .map(l => l.slice(0, 110))
        .join(' ⏎ ')
  );
  console.log('TNAI_SHOT:mods-compat-diff');
  await wait(600);
  check(!!opened, '/diff answered on the CLI screen');
  check(
    during.size === before.size,
    'the CLI screen kept its terminal size while /diff was up (' + during.size + ')'
  );
  check(
    ['waiting', 'idle', 'ready', 'working'].includes(String(during.status).toLowerCase()) ||
      !!during.status,
    'Technically Not still reports a status for the thread: ' + during.status
  );
  check(
    !me().error && me().running !== false,
    'the session is still running, no error (' + (me().error || 'none') + ')'
  );
  check(!/unknown command|Unknown slash/i.test(during.text), 'Claude Code knows /diff');

  // Close whatever it opened and make sure the prompt is back.
  N.pty.write(pane, '\x1b');
  await wait(1200);
  N.pty.write(pane, '\x1b');
  await wait(1200);
  const back = await until(() => /for shortcuts|Try "|❯|>\s*$/m.test(screen()), 8000);
  info('after Esc: status "' + me().status + '", size ' + size());
  check(!!back && size() === before.size, 'after Esc the prompt is back and the size is unchanged');
  const tail = G.tail ? String(G.tail(pane, 6) || '') : '';
  info('tail the app reads for digests: ' + JSON.stringify(strip(tail).slice(-160)));
  console.log('TNAI_SHOT:mods-compat-after');
  await wait(600);
  N.pty.write(pane, '/exit\r');
  await wait(2500);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
try {
  if (pane) await G.stop?.(pane);
} catch {}
return { ok, log };
