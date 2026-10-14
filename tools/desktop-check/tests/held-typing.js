/*
 * Technically Not tools · desktop-check/tests/held-typing.js — A `tnai send` message held for the
 * user's unsent text (attention-service holdIfDraft, held-typing.main.js) shows no "Prompt held"
 * card while the user is typing to that agent on the CLI screen of its thread, and shows it once
 * they leave it. Uses a real PowerShell thread; nothing is sent to it. Returns {ok, log}.
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
    await wait(50);
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

let paneId = '',
  heldId = '';
try {
  const started = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
  paneId = started.paneId;
  check(!!started.session?.running, 'shell started as a thread');

  // Where a user types to it: the CLI screen of its thread (a PowerShell thread opens on it).
  await until(() => window.TnaiThreadView.shown() === paneId, 6000);
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');

  // The screen is put together in steps; its input is taken once the terminal shown is this
  // thread's and has stood for a moment.
  await until(() => window.TnaiThreadView.term()?.tnaiPaneId === paneId, 8000);
  await wait(1000);
  const input = await until(
    () => document.querySelector('.tnt-term-host .xterm-helper-textarea'),
    8000
  );
  check(!!input, 'the thread’s CLI screen shows its terminal');

  // A test window in the background (the user is working in another app) fires no focus events on
  // blur() / focus(): send them, so the card's follow-the-keyboard rule is tested either way.
  const moved = type => {
    if (!document.hasFocus()) document.dispatchEvent(new FocusEvent(type, { bubbles: true }));
  };
  input.focus();
  moved('focusin');
  check(document.activeElement === input, 'the CLI screen has the keyboard');
  const card = document.querySelector('.tnai-perm.tnai-held');
  heldId = await main('hold', paneId);
  check(!!heldId, 'a message is held for the text in that thread');
  await wait(400);
  check(card.hidden, 'typing to it on the CLI screen: no "Prompt held" card');
  input.blur();
  moved('focusout');
  await wait(200);
  check(
    !card.hidden && /unsent text in its input/.test(card.textContent),
    'left the CLI screen, keyboard nowhere: the card shows (' +
      card.querySelector('.tnai-perm-desc').textContent.slice(0, 60) +
      ')'
  );
  input.focus();
  moved('focusin');
  await wait(200);
  check(
    document.activeElement === input && card.hidden,
    'back on the CLI screen: the card hides again'
  );

  // The input box read from the screen (71 boxEmpty; the fault: a message held for an
  // input that was empty). Fake Claude Code screens are drawn into this panel's own terminal view;
  // the shell never gets them.
  const term = window.TnaiAgents.views().find(
      v => v.paneId === paneId && v.where === 'Terminal page panel'
    )?.term,
    rule = '─'.repeat(40);
  const draw = rows =>
    new Promise(done => term.write('\r\n' + rows.join('\r\n') + '\r\n  auto mode on', done));
  const reads = async rows => {
    await draw(rows);
    return window.TnaiNeedsYou.boxEmpty(term);
  };
  check(
    !!term && (await reads([rule, '❯ ', rule])) === true,
    'input box with nothing in it reads as empty'
  );
  check(
    (await reads([rule, '❯ \x1b[2mTry "fix the failing test"\x1b[0m', rule])) === true,
    'a dim placeholder is not text: still empty'
  );
  check((await reads([rule, '❯ hello', rule])) === false, 'typed text in the box: not empty');
  check(
    (await reads([rule, '❯ ', 'second line', rule])) === false,
    'a second input row: not empty'
  );
  check(
    (await reads([rule, '! ', rule])) === false,
    'another prompt marker (bash mode): not read at all'
  );

  // A new panel never takes the name of a sub-agent shown inside a panel (a
  // sub-agent and an agent both named Jade).
  const all = window.TnaiPaneNames.list(),
    real = window.TnaiTeam.aliases;
  window.TnaiTeam.aliases = () => all.slice(1);
  const picks = Array.from({ length: 20 }, () => window.TnaiPaneNames.pick());
  window.TnaiTeam.aliases = real;
  const open = new Set(window.TnaiAgents.sessions().map(session => session.name));
  check(
    picks.every(n => !all.slice(1).includes(n)),
    'new thread names skip sub-agent names (' +
      picks[0] +
      (open.has(all[0]) ? ', ' + all[0] + ' is an open thread' : '') +
      ')'
  );
} catch (e) {
  check(false, 'threw: ' + (e?.stack || e));
}
if (heldId) {
  await main('cleanup', paneId, heldId);
  await wait(300);
}
check(document.querySelector('.tnai-perm.tnai-held').hidden, 'cleanup: no card left');
return { ok, log };
