/*
 * Technically Not tools · desktop-check/tests/redesign-features.js — features without a test of
 * their own (2026-09-30): 10 calmBg (near-black CLI backgrounds become the terminal's own, other
 * colors stay); 119 a press on an agent in the thread list opens its thread and aims the prompt
 * box at it; 10 stopped-panel typing (one block with a hint, Backspace edits, Esc clears, Enter
 * starts the agent and sends the text); 10/11 wake (a prompt box send to a stopped agent starts it
 * and delivers the prompt); 25 per-agent screen zoom (A−/A+ on a saved screen, per agent); 22/17
 * Settings › Agents › Custom agents › New agent opens the form in place
 * (TnaiCustomAgents.openForm). Moved 2026-10-12 off the old Overview: its Agent Tree rows became
 * the thread list's rows; the focus view (99) and the Stop all button (94) went with that page and
 * have no place in the thread layout, so their checks are gone. Real PowerShell panels only (no
 * agent CLI, no usage). Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
  return !!cond;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(60);
  }
  return null;
};
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(500);
};
const go = async view => {
  window.TnaiRoute(view);
  await wait(350);
};
const G = window.TnaiAgents,
  T = window.TnaiLiveTasks;
const strip = s =>
  s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*\x07/g, '').replace(/[\r\n]+/g, '');
const buffer = async id => strip((await window.tnaiNative.pty.replay(id))?.buffer || '');
const running = id => G.sessions().find(s => s.paneId === id)?.running === true;

// What the CLI screen of that thread holds, read from the terminal itself; '' while another
// thread's screen (or none) is shown.
const paneText = id => {
  const term = window.TnaiThreadView.term();
  if (!term || term.tnaiPaneId !== id || !term.element?.getClientRects().length) return '';
  const buffer = term.buffer.active;
  const lines = [];
  for (let row = 0; row < buffer.length; row++)
    lines.push(buffer.getLine(row)?.translateToString(true) || '');
  return lines.join('\n');
};
const opened = [];
try {
  // ---- 10 calmBg: 48;2 with every channel <= 40 and 48;5 blacks become the default background; a
  // real color stays.
  {
    const m = await G.createTerm(),
      t = m.term;
    await new Promise(r =>
      t.write(
        '\x1b[48;2;10;10;10mA\x1b[48;5;232mB\x1b[48;2;200;30;30mC\x1b[38;2;5;5;5;48;2;20;20;20mD\x1b[0m',
        r
      )
    );
    const line = t.buffer.active.getLine(0),
      c = i => line.getCell(i);
    check(
      c(0).isBgDefault() && c(1).isBgDefault(),
      'calmBg: near-black truecolor and 256-color black backgrounds become the terminal’s own'
    );
    check(
      c(2).isBgRGB() && c(2).getBgColor() === 0xc81e1e,
      'calmBg: a real background color stays (#c81e1e)'
    );
    check(
      c(3).isBgDefault() && c(3).isFgRGB() && c(3).getFgColor() === 0x050505,
      'calmBg: a dark foreground in the same SGR is kept, only the background changes'
    );
    t.dispose();
  }

  // ---- Two real PowerShell agents.
  const a = await window.TnaiTest.open('Terminal'),
    b = await window.TnaiTest.open('Terminal');
  check(a?.ok && b?.ok, 'two PowerShell panels opened');
  opened.push(a.paneId, b.paneId);
  check(!!(await until(() => running(a.paneId) && running(b.paneId), 15000)), 'both running');

  // ---- 119 thread list: one row per agent; a press opens its thread and aims the prompt box at
  // it.
  window.TnaiThreads.open();
  await wait(350);
  const threadRow = id => document.querySelector('.tnt-th[data-pane="' + id + '"]:not(.tnt-sub)');
  check(
    !!(await until(
      () => threadRow(a.paneId)?.offsetParent && threadRow(b.paneId)?.offsetParent,
      4000
    )),
    'the thread list shows a row per running agent'
  );
  threadRow(b.paneId).click();
  await wait(250);
  check(
    T.target?.() === b.paneId &&
      window.TnaiThreads.selected() === b.paneId &&
      threadRow(b.paneId).getAttribute('aria-selected') === 'true',
    'a press on a row opens that thread and sends the next message to that agent (target ' +
      T.target?.() +
      ')'
  );
  await shot('redesign-thread-rows');

  // The parts below need both agents stopped (the Stop all button that did it went with the old
  // Overview).
  G.stop(a.paneId);
  G.stop(b.paneId);
  check(
    !!(await until(() => !running(a.paneId) && !running(b.paneId), 8000)),
    'both agents stopped'
  );

  // (The zoom of a saved screen, A− and A+, was a control of the Agents page and went with it.)

  // ---- 10 stopped-panel typing: one block with a hint; Backspace, Esc; Enter starts it and sends
  // the text.
  // On the CLI screen of the stopped agent's thread, where a user types to it.
  window.TnaiThreads.show(a.paneId);
  await until(() => window.TnaiThreadView.shown() === a.paneId, 6000);
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  await until(() => window.TnaiThreadView.term()?.tnaiPaneId === a.paneId, 6000);
  await wait(300);
  G.stoppedInput(
    a.paneId,
    "Write-Output ('typed' + '-ok-' + (4*4))x",
    window.TnaiThreadView.term()
  );
  check(
    !!(await until(
      () =>
        /› Write-Output \('typed' \+ '-ok-' \+ \(4\*4\)\)x/.test(paneText(a.paneId)) &&
        /Enter starts .* and sends this/.test(paneText(a.paneId)),
      3000
    )),
    'typing into a stopped thread shows one › block with the Enter hint on its CLI screen'
  );
  G.stoppedInput(a.paneId, '\x7f', window.TnaiThreadView.term());
  await wait(150);
  check(
    /\(4\*4\)\)(?!x)/.test(paneText(a.paneId)) && !/\(4\*4\)\)x/.test(paneText(a.paneId)),
    'Backspace edits the typed block'
  );
  G.stoppedInput(a.paneId, '\x1b', window.TnaiThreadView.term());
  await wait(150);
  check(
    !/› Write-Output/.test(paneText(a.paneId)) && !running(a.paneId),
    'Esc clears it; the agent stays stopped'
  );

  // A saved agent screen ends in the CLI's own input box: the text goes into that box, at its mark,
  // and the rule and status line under it move down; cleared, the screen is as it was (the
  // fault: a pasted path sat under the box).
  {
    const m = await G.createTerm(),
      t = m.term,
      put = s => new Promise(r => t.write(s, r));
    const rule = '\x1b[2m' + '─'.repeat(t.cols) + '\x1b[0m';
    await put(
      '● earlier reply\r\n\r\n' +
        rule +
        '\r\n❯ \r\n' +
        rule +
        '\r\n  \x1b[33m⏵⏵ auto mode on\x1b[0m · 3 agents'
    );
    const rows = () => {
      const b = t.buffer.active,
        out = [];
      for (let y = 0; y < b.length; y++) out.push(b.getLine(y).translateToString(true).trimEnd());
      while (out.length && !out[out.length - 1]) out.pop();
      return out;
    };
    const key = async data => {
      G.stoppedInput(a.paneId, data, t);
      await put('');
    };

    // Each drawn cell's style and colors on the box's rows, to compare the screen before typing
    // with the one put back.
    const look = () => {
      const b = t.buffer.active,
        out = [];
      for (let y = 2; y <= 5; y++) {
        const line = b.getLine(y);
        for (let x = 0; x < t.cols; x++) {
          const c = line.getCell(x);
          if (c.getChars().trim())
            out.push(
              [
                y,
                x,
                c.isBold(),
                c.isDim(),
                c.getFgColorMode(),
                c.getFgColor(),
                c.getBgColorMode(),
                c.getBgColor(),
              ].join(' ')
            );
        }
      }
      return out;
    };
    const before = rows(),
      lookBefore = look(),
      isRule = s => /^─+$/.test(s || '');
    await key('C:\\pasted\\shot.png');
    let r = rows(),
      at = r.indexOf('❯ C:\\pasted\\shot.png');
    check(
      at === 3 &&
        isRule(r[2]) &&
        isRule(r[4]) &&
        /auto mode on/.test(r[5]) &&
        /Enter starts .* and sends this/.test(r[6]) &&
        r.length === 7,
      'saved input box: the typed text is inside the box, its rule and status line under it, then the hint (' +
        JSON.stringify(r.slice(2).map(s => s.slice(0, 24))) +
        ')'
    );
    await key('x'.repeat(t.cols));
    r = rows();
    check(
      r[3].startsWith('❯ C:\\pasted\\shot.pngx') &&
        /^x+$/.test(r[4]) &&
        isRule(r[5]) &&
        /auto mode on/.test(r[6]) &&
        r.length === 8,
      'saved input box: text that wraps grows the box, the rule stays under it (' +
        r.length +
        ' rows)'
    );
    await key('\x7f');
    check(
      isRule(rows()[5]) && rows()[4].length === r[4].length - 1,
      'saved input box: Backspace edits inside the box'
    );
    await key('\x1b');
    r = rows();
    const lookAfter = look(),
      differs = lookAfter.findIndex((s, i) => s !== lookBefore[i]);
    check(
      JSON.stringify(r) === JSON.stringify(before),
      'saved input box: Esc puts the saved screen back (' +
        r.length +
        ' rows, was ' +
        before.length +
        '; ' +
        JSON.stringify(
          r
            .map((s, i) =>
              s === before[i] ? '' : [i, s.length, s.slice(-24), (before[i] || '').length]
            )
            .filter(Boolean)
        ) +
        ')'
    );
    check(
      lookBefore.length > 160 &&
        lookAfter.length === lookBefore.length &&
        differs < 0 &&
        new Set(lookBefore.map(s => s.split(' ').slice(2).join(' '))).size >= 3,
      'saved input box: every cell has its style and colors back (' +
        lookAfter.length +
        ' cells' +
        (differs < 0
          ? ''
          : ', first difference: was ' + lookBefore[differs] + ', now ' + lookAfter[differs]) +
        ')'
    );

    // a prompt row with plain text of its own is left alone: the block goes under the screen
    await put('\r\n❯ a draft the CLI still held');
    await key('more');
    r = rows();
    check(
      r[6] === '❯ a draft the CLI still held' && r[7] === '› more',
      'a saved prompt row with text of its own is not written over (' +
        JSON.stringify(r.slice(6, 8)) +
        ')'
    );
    await key('\x1b');
    t.dispose();
  }
  G.stoppedInput(a.paneId, "Write-Output ('typed' + '-ok-' + (4*4))");
  await wait(100);
  G.stoppedInput(a.paneId, '\r');
  check(!!(await until(() => running(a.paneId), 10000)), 'Enter starts the stopped agent');
  check(
    !!(await until(async () => (await buffer(a.paneId)).includes('typed-ok-16'), 12000)),
    'the typed text is sent once it is ready'
  );

  // ---- 11 wake: a composer send to the stopped agent B starts it and delivers the prompt.
  T.setTarget(b.paneId);
  await wait(150);
  const prompt = document.getElementById('prompt');
  prompt.value = "Write-Output ('woke' + '-by-send-' + (5*5))";
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('send').click();
  check(
    !!(await until(() => running(b.paneId), 10000)),
    'send to a stopped agent starts it (wake)'
  );
  check(
    !!(await until(async () => (await buffer(b.paneId)).includes('woke-by-send-25'), 12000)),
    'the woken agent gets the prompt'
  );

  // ---- 22 / 17: Settings › Agents › Custom agents › New agent opens the form in place.
  window.TnaiSettings.open('agents');
  await wait(300);
  document.querySelector('#saTab-custom')?.click();
  await wait(200);
  const nb = document.querySelector('#agentsCustom [data-sa="new"]');
  check(!!nb?.offsetParent, 'Custom agents pane shows New agent');
  nb?.click();
  await wait(400);
  const form = document.querySelector('#agentsCustom .tnai-custom-panel');
  check(
    !!form && !form.hidden && !!form.offsetParent,
    'the custom-agent form opens inside Settings (not on Overview)'
  );
  check(
    document.activeElement && form?.contains(document.activeElement),
    'the form’s name field has focus'
  );
  await shot('redesign-custom-agent-form');
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
for (const id of opened) {
  try {
    if (running(id)) G.stop(id);
  } catch {}
}
await until(() => !opened.some(running), 5000);
await wait(300);
return { ok, log };
