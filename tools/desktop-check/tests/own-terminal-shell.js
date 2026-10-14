// Technically Not tools · desktop-check/tests/own-terminal-shell.js — the shell picker of the
// user's own terminal (136, 147; the list is the main process's, agent-registry.js `shells`).
// Checked: the row's shell name carries a list of the shells found on this computer, PowerShell
// first and chosen; choosing Command Prompt asks first, Cancel keeps PowerShell, Switch starts
// Command Prompt in the same panel (proven by a line only Command Prompt prints that way); the
// row names it; no thread, mark or picker entry appears for it. Then the window is reloaded and
// own-terminal-shell.after.js goes on: the choice is remembered, and PowerShell comes back when
// chosen. A computer with one shell only has no list, and the test says so and passes.
// Picture: own-terminal-shell. Returns {ok, log, reload}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const own = () => window.TnaiOwnTerminal;
const shown = el => !!el && el.getClientRects().length > 0;
const session = paneId => agents.sessions().find(one => one.paneId === paneId) || null;
const textOf = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < buffer.length; row++)
    rows.push(buffer.getLine(row)?.translateToString(true) || '');
  return rows.join('\n');
};
const row = () => document.querySelector('.tnt-ownterm-row');
const question = () => document.querySelector('.tnt-ownterm .tnai-panel-confirm');
const answer = async word => {
  const asked = await until(() => question(), 3000);
  const button = [...(asked?.querySelectorAll('button') || [])].find(one =>
    new RegExp(word, 'i').test(one.textContent)
  );
  const words = asked?.textContent || '';
  button?.click();
  return words;
};
let reload = false;

try {
  await until(() => threads?.visible());
  window.TnaiThreadSide.open('terminal');
  const ownId = (await until(() => own().paneId(), 15000)) || '';
  await until(() => session(ownId)?.running, 20000);
  const term = await until(() => own().term(), 10000);
  await until(() => textOf(term).trim().length > 0, 30000);
  const list = (await until(() => (own().shells().length ? own().shells() : null), 15000)) || [];
  log.push('note shells found on this computer: ' + list.map(shell => shell.name).join(', '));
  const name = row().querySelector('.tnt-ownterm-shell');
  const pick = row().querySelector('.tnt-ownterm-shellbox select');
  check(
    list[0]?.id === 'powershell' && own().shell() === 'powershell',
    'PowerShell is the first shell of the list and the one chosen'
  );
  check(
    name.textContent === 'PowerShell' && pick.options.length === list.length,
    'the row names it and its list holds the shells found (' + pick.options.length + ')'
  );
  if (!list.some(shell => shell.id === 'cmd')) {
    log.push('note this computer has no other shell: nothing to choose, the list is not shown');
    check(!shown(pick), 'with one shell the list is not shown');
  } else {
    check(
      shown(pick) &&
        pick.getAttribute('aria-label') === 'Shell of your terminal' &&
        Math.round(pick.getBoundingClientRect().width) >=
          Math.round(name.getBoundingClientRect().width),
      'the list lies over the name, so a press on the name opens it'
    );
    console.log('TNAI_SHOT:own-terminal-shell');
    await wait(700);

    // ---- Cancel keeps the shell ----
    const startedAt = session(ownId).startedAt;
    pick.value = 'cmd';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    const asked = await answer('cancel');
    check(
      /Switch to Command Prompt\?/.test(asked),
      'choosing another shell asks first ("' + asked.slice(0, 40) + '")'
    );
    await wait(500);
    check(
      own().shell() === 'powershell' &&
        pick.value === 'powershell' &&
        session(ownId).startedAt === startedAt,
      'Cancel keeps PowerShell running and the list back on it'
    );

    // ---- Switch starts the chosen shell in the same panel ----
    pick.value = 'cmd';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    await answer('switch');
    check(
      !!(await until(
        () => session(ownId)?.running && session(ownId).startedAt !== startedAt,
        30000
      )),
      'Switch starts a new shell in the same panel (' + ownId + ')'
    );
    await wait(2500);

    // only Command Prompt puts the value in for %OS%; PowerShell prints the text as it is
    term.input('echo own-%OS%-shell\r', true);
    check(
      !!(await until(() => textOf(term).includes('own-Windows_NT-shell'), 20000)),
      'it is Command Prompt: "echo own-%OS%-shell" prints own-Windows_NT-shell'
    );
    check(
      name.textContent === 'Command Prompt' && own().shell() === 'cmd' && own().paneId() === ownId,
      'the row names it (' + name.textContent + ')'
    );
    await wait(600);
    const marks = [...document.querySelectorAll('.tnai-to-av')].map(mark => mark.dataset.to);
    check(
      !marks.includes(ownId) && window.TnaiThreadList.thread(ownId) === null,
      'it is still no thread and no place to send a prompt to'
    );
    reload = true;
    localStorage.setItem('tnai.test.own-terminal-shell', ownId);
  }
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
if (!reload) {
  const left = own()?.paneId();
  if (left) await agents.stop(left).catch(() => {});
  await wait(2500);
}
return { ok, log, reload };
