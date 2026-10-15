// Technically Not tools · desktop-check/tests/composer-stop.js — Stop in the prompt box
// (src/scripts/150-composer-stop.js, desktop/user-interrupt.js). One PowerShell thread is opened
// and runs a long Start-Sleep; its panel is marked working, as 10 marks a working agent. Checked:
// no Stop while nothing works; Stop stands before Send at the pop-out button's size with its icon
// centered, and 44 by 44 under touch; its menu opens with two rows and the first focused, Escape
// closes it and gives the keyboard back; "Stop where it is" really ends the running command (Ctrl+C
// for a shell) and the prompt box stays empty; "Cancel prompt and edit it" ends it too and puts the
// words last sent to that thread back into the prompt box. Picture: composer-stop-menu. Returns
// {ok, log}.
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
const shot = async name => {
  await wait(400);
  console.log('TNAI_SHOT:' + name);
  await wait(700);
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;
const sessionOf = paneId => agents.sessions().find(session => session.paneId === paneId);
const stopButton = () => document.querySelector('.composebox > .tnai-composer-stop');
const shown = el => !!el && el.getClientRects().length > 0;
const menuShown = () =>
  [...document.querySelectorAll('.tnt-menu.tnt-menu-thread')].find(menu => !menu.hidden);
const prompt = () => document.getElementById('prompt');

// The shell's screen as text, to see whether a command still runs.
async function screenText(paneId) {
  const replay = await native.pty.replay(paneId);
  return String(replay?.buffer || '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');
}

// A long command in the shell, and its panel marked working.
async function busy(paneId) {
  native.pty.write(paneId, 'Start-Sleep -Seconds 90\r');
  await wait(800);
  const panel = document.querySelector('.terminal-pane[data-pane-id="' + paneId + '"]');
  panel.dataset.status = 'working';
  return until(() => shown(stopButton()), 3000);
}

// The command ended when a marker typed after it comes back before the 90 s are over.
async function ended(paneId, marker) {
  native.pty.write(paneId, "echo '" + marker + "'\r");
  return until(async () => (await screenText(paneId)).split(marker).length > 2, 6000);
}

const opened = [];
try {
  await main('size', 1440, 900);
  threads.open();
  await until(() => threads.visible(), 5000);
  const shell = (await window.TnaiTest.open('Terminal'))?.paneId || '';
  check(!!(await until(() => sessionOf(shell)?.running)), 'setup: a PowerShell thread runs');
  if (shell) opened.push(shell);
  threads.show(shell);
  window.TnaiLiveTasks.setTarget(shell);
  await wait(1500);
  prompt().value = '';
  const idlePanel = document.querySelector('.terminal-pane[data-pane-id="' + shell + '"]');
  check(
    !!(await until(() => !shown(stopButton()), 5000)),
    'no Stop while the thread does not work (status ' +
      idlePanel?.dataset.status +
      ' / ' +
      sessionOf(shell)?.status +
      ')'
  );

  // ---- the button
  check(!!(await busy(shell)), 'Stop shows while the thread works');
  const stop = stopButton();
  const after = stop.nextElementSibling;
  check(
    after?.id === 'send' ||
      (after?.classList.contains('tnai-new-agent') && after.nextElementSibling?.id === 'send'),
    'Stop stands before Send, New agent stays next to Send (' + (after?.className || '') + ')'
  );
  const pop = document.querySelector('.composebox > .tnai-composer-pop');
  if (shown(pop)) {
    const a = stop.getBoundingClientRect();
    const b = pop.getBoundingClientRect();
    check(
      Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height),
      'Stop has the pop-out button size (' + a.width + 'x' + a.height + ')'
    );
  }
  const own = stop.getBoundingClientRect();
  const ico = stop.querySelector('svg')?.getBoundingClientRect();
  check(
    !!ico &&
      Math.abs(ico.left + ico.width / 2 - (own.left + own.width / 2)) <= 1 &&
      Math.abs(ico.top + ico.height / 2 - (own.top + own.height / 2)) <= 1,
    'its icon is centered within 1 px'
  );

  // ---- under touch it is finger sized, as the box's other buttons (36)
  await main('touch', true);
  const finger = stop.getBoundingClientRect();
  check(
    finger.width >= 43.5 && finger.height >= 43.5,
    'under touch Stop is 44 by 44 (43.5 allows the window scale; ' +
      finger.width +
      'x' +
      finger.height +
      ')'
  );
  await main('touch', false);

  // ---- the menu
  stop.click();
  const menu = await until(() => menuShown(), 2000);
  const rows = menu ? [...menu.querySelectorAll('.tnt-menu-row')] : [];
  check(
    rows.map(row => row.textContent.trim()).join(' | ') ===
      'Stop where it is | Cancel prompt and edit it',
    'the menu has its two rows'
  );
  check(document.activeElement === rows[0], 'the first row has the keyboard');
  await shot('composer-stop-menu');
  rows[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);
  check(!menuShown() && document.activeElement === stop, 'Escape closes it, focus back on Stop');

  // ---- Stop where it is
  stop.click();
  (await until(() => menuShown(), 2000))?.querySelector('[data-row=stop]').click();
  await wait(1500);
  check(!!(await ended(shell, 'tnai-stop-one')), 'Stop where it is ends the running command');
  check(prompt().value === '', 'and the prompt box stays empty');

  // ---- Cancel prompt and edit it
  // Sent with one attachment chip, in 11 dispatch's order: beginSend, record, commit.
  const files = window.TnaiAttachments;
  files.add([new File(['hello'], 'notes.txt')]);
  const snap = files.beginSend();
  window.TnaiLiveTasks.record(shell, 'make the header sticky', 'test');
  snap.commit();
  check(files.count() === 0, 'the sent chip has left the box');
  check(!!(await busy(shell)), 'Stop shows again for the next command');
  stopButton().click();
  (await until(() => menuShown(), 2000))?.querySelector('[data-row=cancel]').click();
  await wait(1500);
  check(!!(await ended(shell, 'tnai-stop-two')), 'Cancel prompt ends the running command');
  check(
    prompt().value === 'make the header sticky',
    'and the last prompt is back in the box ("' + prompt().value + '")'
  );
  check(
    files.count() === 1 && files.list()[0].name === 'notes.txt',
    'and its attachment chip is back too (' + files.count() + ')'
  );

  // A later prompt without chips: Cancel must not bring back the earlier prompt's chip.
  files.clear();
  window.TnaiLiveTasks.record(shell, 'second prompt', 'test');
  check(files.takeSent(shell) === 0, 'a prompt sent without chips gives none back');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
prompt().value = '';
prompt().dispatchEvent(new Event('input', { bubbles: true }));
window.TnaiAttachments?.clear();
for (const paneId of opened) await agents.stop(paneId).catch(() => {});
await main('cleanup').catch(() => {});
return { ok, log };
