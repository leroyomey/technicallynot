/*
 * Technically Not tools · desktop-check/tests/powershell-link.js — "PowerShell" in an agent's
 * terminal output is a link (90): hover shows the pointer, a click opens a new PowerShell thread
 * in the project folder; a tnai://powershell?cmd= link (also OSC 8,
 * hard-wrapped, or a plain "PS> command" line) sends its command whole plus Enter to the new panel
 * (one entry, it runs) and only on a click; a PowerShell session's own view gets no links. The
 * "agent" terminal is a createTerm in a detached box with text written into it; the opened panels
 * are real PowerShell processes, stopped at the end. Windows only. Returns {ok, log}.
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
    await wait(100);
  }
  return null;
};
const native = window.tnaiNative,
  agents = window.TnaiAgents,
  link = window.TnaiPowerShellLink;
const ANSI =
  /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g;
const norm = p =>
  String(p || '')
    .replace(/[\\/]+$/, '')
    .toLowerCase();
const started = [];

// The confirm box of an OSC 8 link (90) is answered here: what it asked is kept, the answer is
// sayYes.
const asked = [],
  realConfirm = window.confirm;
let sayYes = true;
window.confirm = text => {
  asked.push(String(text));
  return sayYes;
};
const box = document.createElement('div');
box.style.cssText =
  'position:fixed;left:0;top:0;width:900px;height:240px;z-index:9999;background:#fff';
document.body.append(box);
try {
  check(!!link?.commandOf, 'link module loaded');
  check(
    link.commandOf('tnai://powershell?cmd=echo%20hi') === 'echo hi',
    'commandOf decodes the command'
  );
  check(
    link.commandOf('tnai://powershell?cmd=echo%20a%0D%0Aecho%20b') === 'echo a echo b',
    'CR/LF in a command are dropped (nothing can press Enter)'
  );
  {
    const W = window.TnaiTerminalWorkspaces;
    check(
      W.activate(W.activeId()) === true &&
        W.activate('no-such-workspace') === false &&
        !!W.activeId(),
      'a clicked command can show the workspace of its agent; an unknown one changes nothing'
    );
  }
  check(
    link.commandOf('tnai://other?cmd=x') === null && link.commandOf('https://example.com') === null,
    'other links are not PowerShell links'
  );
  const rootRes = await native.fs.root();
  const root = typeof rootRes === 'string' ? rootRes : rootRes?.value || '';
  check(!!root, 'a project folder is open (' + root + ')');

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
  const findText = (t, s) => {
    const b = t.buffer.active;
    for (let y = 0; y < b.length; y++) {
      const x = b.getLine(y)?.translateToString(true).indexOf(s) ?? -1;
      if (x >= 0) return { x, y: y - b.viewportY };
    }
    return null;
  };
  const hover = async (t, s, dx = 2) => {
    const p = findText(t, s);
    if (!p) return null;
    const at = cellAt(p.x + dx, p.y);
    mouse('mousemove', at);
    await wait(150);
    return at;
  };
  const pointer = t =>
    t.element.classList.contains('xterm-cursor-pointer') ||
    !!t.element.querySelector('.xterm-cursor-pointer');
  const click = async at => {
    mouse('mousedown', at);
    mouse('mouseup', at);
    mouse('click', at);
  };
  const newShell = before =>
    until(
      () =>
        agents.sessions().find(s => s.agent === 'Terminal' && s.running && !before.has(s.paneId)),
      20000
    );

  // 1. The plain word: opens a PowerShell thread in the project folder,
  // nothing typed.
  await new Promise(r =>
    term.write(
      'Claude: open a PowerShell terminal panel and run the wrangler step yourself.\r\n',
      r
    )
  );
  let at = await hover(term, 'PowerShell');
  check(!!at && pointer(term), 'hovering "PowerShell" shows the link pointer');
  const tipEl = await until(
    () => [...document.querySelectorAll('[role=tooltip]')].find(e => e.classList.contains('is-on')),
    2500
  );
  if (!tipEl)
    log.push(
      '     title now: ' +
        JSON.stringify(term.element.getAttribute('title')) +
        ', hidden: ' +
        document.hidden +
        ', focus: ' +
        document.hasFocus()
    );
  check(
    tipEl?.textContent === 'Open a PowerShell thread',
    'tooltip shows after resting on the link (' + (tipEl?.textContent || 'none') + ')'
  );
  let before = new Set(agents.sessions().map(s => s.paneId));
  if (!at || !pointer(term))
    log.push(
      '     before the click: link cell ' +
        !!at +
        ', pointer ' +
        pointer(term) +
        ', focus: ' +
        document.hasFocus()
    );
  if (at) {
    mouse('mousemove', at);
    await wait(300);

    // settle on the link cell again (as runCase does): the wait for the tip can outlast xterm's
    // hover in a background window
  }
  await click(at);
  const first = await newShell(before);
  check(!!first, 'click opened a new PowerShell thread');
  if (first) {
    started.push(first.paneId);

    // Where the click lands: the new thread is on screen, on the All threads page (where the
    // app's route for a new PowerShell thread ends today) or as the open thread on Threads.
    const onAllThreads = !!(await until(
      () => window.TnaiAllThreads?.on && window.TnaiAllThreads.state().order.includes(first.paneId),
      4000
    ));
    const openOnThreads =
      window.TnaiThreads.visible() && String(window.TnaiThreads.selected()) === first.paneId;
    check(
      onAllThreads || openOnThreads,
      'the new thread is on screen after the click (' +
        (onAllThreads ? 'on the All threads page' : openOnThreads ? 'open on Threads' : 'nowhere') +
        ')'
    );
    check(
      norm(first.cwd) === norm(root),
      'panel working folder is the project folder (' + first.cwd + ')'
    );

    // The prompt itself shows where PowerShell really is (any prompt style: PS C:\…>, oh-my-posh
    // …): the project folder's name, after the first prompt.
    const base = norm(root).split(/[\\/]/).pop();
    const shown = await until(
      async () =>
        String((await native.pty.replay(first.paneId))?.buffer || '')
          .replace(ANSI, '')
          .toLowerCase()
          .includes(base),
      10000
    );
    check(!!shown, 'PowerShell prompt shows the project folder (' + base + '), not system32');

    // The user can type into it at once: the keyboard is in a terminal of the new thread that
    // is on screen (its CLI screen), not in one nobody sees.
    const focused = document.activeElement;
    const inItsScreen =
      window.TnaiThreadView?.term?.()?.tnaiPaneId === first.paneId &&
      !!window.TnaiThreadView.term().element?.contains(focused) &&
      focused.getClientRects().length > 0;
    check(
      inItsScreen,
      'the new thread has the keyboard, in a terminal that is on screen (focus is on ' +
        (focused?.tagName || 'nothing') +
        '.' +
        String(focused?.className || '').slice(0, 40) +
        ', on screen ' +
        !!focused?.getClientRects().length +
        ')'
    );
  }

  // 2. Every form of the command opens a new panel and the command arrives whole with Enter (one
  // submitted entry, so it RUNS) — never before the click. Each case is what an agent's terminal
  // can really show: a plain tnai:// link, one as an OSC 8 hyperlink, a long link the CLI
  // hard-wrapped onto indented rows (Claude Code wraps to the terminal width with real newlines),
  // and a plain "PS> command" line from a code block.
  const enc = c => encodeURIComponent(c);

  // The calm tips (83) park a hovered control's title and show it after a rest, and hide it when
  // the window isn't focused: watch the title being set, so the exact tip text is checked even in a
  // background window.
  const titles = [];
  new MutationObserver(records => {
    for (const r of records) {
      if (r.oldValue) titles.push(r.oldValue);
    }
    const t = term.element.getAttribute('title');
    if (t) titles.push(t);
  }).observe(term.element, {
    attributes: true,
    attributeFilter: ['title'],
    attributeOldValue: true,
  });

  // reuse: the panel expected to take the command (an idle PowerShell panel already open), or null
  // when a new panel must open.
  const runCase = async (name, text, hoverText, marker, cols, reuse) => {
    titles.length = 0;
    term.reset();
    if (cols) term.resize(cols, term.rows);
    else fit.fit();
    await new Promise(r => term.write(text, r));
    await wait(100);
    let h = null;
    for (let i = 0; i < 4 && !(h && pointer(term)); i++) {
      mouse('mouseleave', cellAt(0, 0));
      mouse('mousemove', cellAt(term.cols - 1, term.rows - 1));
      await wait(150);
      h = await hover(term, hoverText, 2 + i);
    } // elsewhere first: xterm keeps the last hovered cell across reset()
    check(!!h && pointer(term), name + ': hovering the command shows the link pointer');
    check(
      !!(await until(
        () => titles.includes('Open a PowerShell thread and run: ' + marker.cmd),
        2500
      )),
      name +
        ': the tip is the exact command (titles seen: ' +
        JSON.stringify(titles.slice(-3)) +
        ')'
    );

    // the panel counts as idle once it has been quiet a moment at its prompt
    if (reuse) await wait(1800);
    const seen = new Set(agents.sessions().map(s => s.paneId));
    await wait(200); // nothing runs before the click
    check(
      agents.sessions().every(s => seen.has(s.paneId)),
      name + ': nothing opened before the click'
    );
    if (h) {
      mouse('mousemove', h);
      await wait(300);
      await click(h);
    } // settle on the link cell so xterm's async link lookup has answered
    let panel;
    if (reuse) {
      await wait(2500); // long enough for a new panel to have shown up if one were opened
      const extra = agents.sessions().filter(s => s.agent === 'Terminal' && !seen.has(s.paneId));
      extra.forEach(s => started.push(s.paneId));
      check(
        !extra.length,
        name + ': the idle PowerShell panel is used, no new panel opens (' + extra.length + ' new)'
      );
      panel = reuse;
    } else {
      panel = await newShell(seen);
      check(!!panel, name + ': click opened a new PowerShell thread');
      if (!panel) return;
      started.push(panel.paneId);
    }
    const buf = async () =>
      String((await native.pty.replay(panel.paneId))?.buffer || '').replace(ANSI, '');

    // The marker is built by the command ('TNAI'+'RAN'), so it appears as a line of its own only
    // when the command really ran.
    const ran = await until(
      async () => (await buf()).split(/\r?\n/).some(l => l.trim() === marker.out),
      12000
    );
    check(
      !!ran,
      name +
        ': command arrived whole and ran (output line "' +
        marker.out +
        '")' +
        (ran ? '' : ' tail ' + JSON.stringify((await buf()).slice(-300)))
    );
  };
  const cmdOf = tag => "echo ('" + tag.slice(0, 4) + "'+'" + tag.slice(4) + "')";

  // The panel from step 1 is busy (a command still running in it): the first command opens a new
  // panel. That panel is then idle at its prompt, so the next commands run in it instead of opening
  // one panel per click. A panel that is busy again is not used.
  if (first) agents.send(first.paneId, 'Start-Sleep 60');
  await wait(800);
  const before2 = new Set(agents.sessions().map(s => s.paneId));
  await runCase(
    'link',
    'Run it in a PowerShell terminal panel: tnai://powershell?cmd=' +
      enc(cmdOf('TNAIRAN')) +
      '\r\n',
    'tnai://powershell',
    { cmd: cmdOf('TNAIRAN'), out: 'TNAIRAN' }
  );
  const second =
    agents.sessions().find(s => s.agent === 'Terminal' && s.running && !before2.has(s.paneId)) ||
    null;
  check(
    asked.length === 0,
    'a plain tnai:// link shows its command and runs on the one click, no question'
  );

  // An OSC 8 link shows its writer's words over the command: other words than
  // the command → the command is shown and the user says yes first; the command itself as the words
  // → the one click, as before; No → nothing opens and nothing runs.
  await runCase(
    'osc8',
    'Run it: \x1b]8;;tnai://powershell?cmd=' +
      enc(cmdOf('OSCRAN')) +
      '\x07run it here\x1b]8;;\x07\r\n',
    'run it here',
    { cmd: cmdOf('OSCRAN'), out: 'OSCRAN' },
    0,
    second
  );
  check(
    asked.length === 1 && asked[0].includes(cmdOf('OSCRAN')),
    'osc8: other words than the command, so it asks first and shows the command (' +
      asked.length +
      ' asked)'
  );
  await runCase(
    'osc8 showing its command',
    'Run it: \x1b]8;;tnai://powershell?cmd=' +
      enc(cmdOf('SAMERAN')) +
      '\x07' +
      cmdOf('SAMERAN') +
      '\x1b]8;;\x07\r\n',
    "echo ('SAME",
    { cmd: cmdOf('SAMERAN'), out: 'SAMERAN' },
    0,
    second
  );
  check(
    asked.length === 1,
    'osc8 showing its command: no question (' + asked.length + ' asked in all)'
  );
  {
    sayYes = false;
    term.reset();
    fit.fit();
    await new Promise(r =>
      term.write(
        'See \x1b]8;;tnai://powershell?cmd=' +
          enc(cmdOf('DENYRAN')) +
          '\x07open the docs\x1b]8;;\x07\r\n',
        r
      )
    );
    await wait(100);
    let h = null;
    for (let i = 0; i < 4 && !(h && pointer(term)); i++) {
      mouse('mouseleave', cellAt(0, 0));
      mouse('mousemove', cellAt(term.cols - 1, term.rows - 1));
      await wait(150);
      h = await hover(term, 'open the docs', 2 + i);
    }
    const seen = new Set(agents.sessions().map(s => s.paneId));
    if (h) {
      mouse('mousemove', h);
      await wait(300);
      await click(h);
    }
    await wait(2500);
    const extra = agents.sessions().filter(s => !seen.has(s.paneId));
    extra.forEach(s => started.push(s.paneId));
    const ran = (
      await Promise.all(
        started.map(async id =>
          String((await native.pty.replay(id))?.buffer || '').replace(ANSI, '')
        )
      )
    ).some(b => b.split(/\r?\n/).some(l => l.trim() === 'DENYRAN'));
    check(
      !!h && asked.length === 2 && asked[1].includes(cmdOf('DENYRAN')),
      'osc8 "open the docs": asks, with the command it would run'
    );
    check(!extra.length && !ran, 'answered No: no panel opens and the command does not run');
    sayYes = true;
  }
  check(
    link.showsCommand('echo hi', 'echo hi', 'x') &&
      link.showsCommand('PS> echo hi', 'echo hi', 'x') &&
      link.showsCommand(
        'tnai://powershell?cmd=echo%20hi',
        'echo hi',
        'tnai://powershell?cmd=echo%20hi'
      ) &&
      !link.showsCommand('open the docs', 'echo hi', 'x') &&
      !link.showsCommand('', 'echo hi', 'x') &&
      !link.showsCommand('echo', 'echo hi', 'x'),
    'the words count as the command only when they are the whole command, its PS> line or its tnai:// address'
  );
  const longCmd = cmdOf('WRAPRAN') + ' # ' + 'x'.repeat(70),
    url = 'tnai://powershell?cmd=' + enc(longCmd),
    W = 50,
    rows = [];
  for (let i = 0; i < url.length; i += W - 2) rows.push((i ? '  ' : '') + url.slice(i, i + W - 2));
  await runCase(
    'hard-wrapped link',
    rows.join('\r\n') + '\r\n',
    'tnai://powershell',
    { cmd: longCmd, out: 'WRAPRAN' },
    W,
    second
  );

  // both panels busy now: the next command gets a panel of its own
  if (second) agents.send(second.paneId, 'Start-Sleep 60');
  await wait(800);
  await runCase(
    'plain command',
    '  Run this in a new PowerShell panel:\r\n\r\n    PS> ' +
      cmdOf('PSGTRAN') +
      '\r\n\r\nthen tell me.\r\n',
    "echo ('PSGT",
    { cmd: cmdOf('PSGTRAN'), out: 'PSGTRAN' }
  );
  term.reset();
  fit.fit();
  await new Promise(r =>
    term.write('A > b, echo NOTRUN, is no command; PS> alone neither.\r\n', r)
  );
  await wait(100);
  {
    const h = await hover(term, 'echo NOTRUN');
    check(!h || !pointer(term), 'text that is not a "PS> command" line is not a link');
  }

  // 2b. The panel is named after the agent whose terminal showed the command, and the command is
  // its task (facts only). The test's agent terminal has no panel, so the naming step is called as
  // the click calls it, with the first panel standing in for the agent.
  if (first && second) {
    const nameOf = id => agents.sessions().find(s => s.paneId === id)?.name,
      who = nameOf(first.paneId),
      toasts = document.querySelectorAll('.toast').length;
    link.label(second.paneId, first.paneId, 'echo one', true);
    await wait(200);
    check(
      nameOf(second.paneId) === 'PowerShell · for ' + who &&
        window.TnaiLiveTasks.get(second.paneId)?.text === 'echo one',
      'the opened panel is named "PowerShell · for ' +
        who +
        '" and the command is its task (' +
        nameOf(second.paneId) +
        ')'
    );
    check(
      nameOf(first.paneId) === who && document.querySelectorAll('.toast').length === toasts,
      'the agent keeps its name and no toast is shown for the name'
    );
    link.label(second.paneId, first.paneId, 'echo two', false);
    await wait(200);
    check(
      nameOf(second.paneId) === 'PowerShell · for ' + who &&
        window.TnaiLiveTasks.get(second.paneId)?.text === 'echo two',
      'used again: same name, the task is the new command'
    );
    await window.TnaiPaneNames.rename(second.paneId, 'Mine', true);
    link.label(second.paneId, first.paneId, 'echo three', false);
    await wait(200);
    check(nameOf(second.paneId) === 'Mine', 'a name the user gave the panel is kept');
    const third = agents
      .sessions()
      .find(
        s =>
          s.agent === 'Terminal' &&
          started.includes(s.paneId) &&
          s.paneId !== first.paneId &&
          s.paneId !== second.paneId
      );
    if (third) {
      await window.TnaiPaneNames.rename(second.paneId, 'PowerShell · for ' + who, true);
      link.label(third.paneId, first.paneId, 'echo four', true);
      await wait(200);
      check(
        nameOf(third.paneId) === 'PowerShell · for ' + who + ' 2',
        'a second panel for the same agent gets " 2" (' + nameOf(third.paneId) + ')'
      );
    }
  }

  // 3. Inside a PowerShell session's own view: no links.
  if (first) {
    const { term: shellView, fit: f2 } = await agents.createTerm();
    const box2 = document.createElement('div');
    box2.style.cssText = box.style.cssText;
    box.after(box2);
    shellView.tnaiPaneId = first.paneId;
    shellView.open(box2);
    f2.fit();
    await wait(150);
    await new Promise(r => shellView.write('Windows PowerShell\r\n', r));
    const s2 = shellView.element.querySelector('.xterm-screen'),
      p = findText(shellView, 'PowerShell'),
      r2 = s2.getBoundingClientRect();
    s2.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: r2.left + ((p.x + 2.5) * r2.width) / shellView.cols,
        clientY: r2.top + ((p.y + 0.5) * r2.height) / shellView.rows,
      })
    );
    await wait(150);
    check(!pointer(shellView), 'no link in a PowerShell panel itself');
    shellView.dispose();
    box2.remove();
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
  'opened PowerShell panels stopped'
);
box.remove();
window.confirm = realConfirm;
return { ok, log };
