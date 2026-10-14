// Technically Not tools · desktop-check/tests/thread-start.js — the controls for starting and
// switching threads: the New thread start screen (src/scripts/140-thread-start.js), the on/off
// button on the thread's top row and the right press on a thread in the list (137).
// One PowerShell thread is opened; no prompt is sent and no agent starts. Checked: New thread
// shows the start screen in place of the thread, with the project's name, a button per tool and
// "Your terminal"; a press on a tool chooses it for the next prompt (the prompt box's New agent
// says the same tool); Cancel turns New thread off and the thread is back; a press on a thread in
// the list while the screen shows does the same; the on/off button stops the thread (after its
// question) and starts it again; a right press on a thread in the list opens its menu; and in a
// small window nothing on the start screen lies over anything else or out of the island.
// Pictures: thread-start-dark, thread-start-light, thread-start-small, thread-start-power.
// Returns {ok, log}.
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
const threads = window.TnaiThreads;
const live = window.TnaiLiveTasks;
const view = () => window.TnaiThreadView;
const box = el => el.getBoundingClientRect();
const shown = el => !!el && el.getClientRects().length > 0;
const sessionOf = paneId => agents.sessions().find(session => session.paneId === paneId);

// Pairs of shown buttons or texts inside a part that lie over each other.
const overlaps = part => {
  const parts = [...part.querySelectorAll('*')].filter(
    el =>
      el.getClientRects().length &&
      (el.matches('button') ||
        (!el.children.length && el.textContent.trim() && !el.closest('button')))
  );
  const found = [];
  for (let first = 0; first < parts.length; first++)
    for (let second = first + 1; second < parts.length; second++) {
      if (parts[first].contains(parts[second]) || parts[second].contains(parts[first])) continue;
      const one = box(parts[first]);
      const two = box(parts[second]);
      const across = Math.min(one.right, two.right) - Math.max(one.left, two.left);
      const down = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
      if (across > 2 && down > 2)
        found.push(parts[first].textContent.trim() + ' | ' + parts[second].textContent.trim());
    }
  return found;
};

const opened = [];

// Puts the prompt box's worktree label back as it was (the Where row's measures unhide it).
let restoreWorktree = () => {};
try {
  await agents.detect(true);
  await main('size', 1440, 900);
  threads.open();
  await until(() => threads.visible(), 5000);
  const shell = (await window.TnaiTest.open('Terminal'))?.paneId || '';
  check(!!(await until(() => sessionOf(shell)?.running)), 'setup: a PowerShell thread runs');
  if (shell) opened.push(shell);
  threads.open();
  await until(() => threads.visible(), 4000);
  threads.select(shell);
  await until(() => view().shown() === shell, 6000);

  const island = threads.slot('main');
  const start = () => island.querySelector('.tnt-start');
  const newButton = () => threads.slot('list').querySelector('.tnt-new');
  const listRow = paneId =>
    threads.slot('list').querySelector('[data-pane="' + CSS.escape(paneId) + '"]');
  const tools = () => [...island.querySelectorAll('.tnt-start-tool')];
  const usable = () => tools().filter(tool => !tool.disabled && tool.dataset.key !== 'terminal');

  // ---- the start screen ----
  check(!shown(start()), 'no start screen while New thread is off');
  newButton().click();
  await wait(300);
  check(!!live.newAgent() && shown(start()), 'New thread shows the start screen');
  check(
    !shown(island.querySelector('.tnt-head')) && !shown(island.querySelector('.tnt-term')),
    "the thread's top row and screen step aside for it"
  );
  const project = start().querySelector('h2 em')?.textContent || '';
  check(project.length > 0, 'the question names the project (' + project + ')');
  const names = tools().map(tool => tool.textContent.trim());
  check(
    ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode'].every(name =>
      names.some(text => text.startsWith(name))
    ) && names.includes('Your terminal'),
    'every tool has a button, and Your terminal (' + names.join(', ') + ')'
  );
  check(
    tools()
      .filter(tool => tool.disabled)
      .every(tool => / · not (installed|signed in)$/.test(tool.textContent.trim())),
    'a tool that cannot start is greyed with the reason'
  );
  const pressed = tools().filter(tool => tool.getAttribute('aria-pressed') === 'true');
  check(
    pressed.length === 1 && pressed[0].textContent.trim().startsWith(live.newAgent()),
    'the tool New thread will start is the pressed one (' + live.newAgent() + ')'
  );
  check(overlaps(start()).length === 0, 'nothing on the screen lies over anything else');

  // The Where row shows only in a git project and the test project is none, so its label in the
  // prompt box is unhidden here for the measures and the pictures, and hidden again at the end.
  const worktreeLabel = document.getElementById('wtCompose')?.closest('label');
  const worktreeWasHidden = !!worktreeLabel?.hidden;
  restoreWorktree = () => {
    if (worktreeLabel) worktreeLabel.hidden = worktreeWasHidden;
    window.TnaiThreadStart?.paint?.();
  };
  if (worktreeLabel) worktreeLabel.hidden = false;
  window.TnaiThreadStart?.paint?.();
  await wait(200);
  const measureWhere = () => {
    const row = start().querySelector('.tnt-start-where');
    const halves = [...row.querySelectorAll('[data-where]')];
    const label = row.querySelector('.tnt-start-label');
    const chip = tools()[0];
    const rows = halves.map(box);
    const center = rect => rect.top + rect.height / 2;
    const segBox = box(row.querySelector('.tnt-menu-seg'));
    const rowBox = box(row);
    const tableBox = box(start());
    return {
      shown: shown(row),
      oneLine:
        halves.every(half => half.scrollHeight <= half.clientHeight + 1) &&
        halves.every(half => half.getClientRects().length === 1) &&
        halves.every(half => {
          const range = document.createRange();
          range.selectNodeContents(half);
          return range.getClientRects().length === 1;
        }),
      sameHeight: Math.abs(rows[0].height - rows[1].height) < 0.5,
      sameWidth: Math.abs(rows[0].width - rows[1].width) < 0.5,
      segHeight: segBox.height,
      chipHeight: box(chip).height,
      fontSame: getComputedStyle(halves[0]).fontSize === getComputedStyle(chip).fontSize,
      labelOff: Math.abs(center(box(label)) - center(segBox)),
      rowOff: Math.abs(rowBox.left + rowBox.width / 2 - (tableBox.left + tableBox.width / 2)),
    };
  };
  const whereText = where =>
    'seg ' +
    where.segHeight.toFixed(1) +
    ' px, chip ' +
    where.chipHeight.toFixed(1) +
    ' px, label off ' +
    where.labelOff.toFixed(1) +
    ' px, row off center ' +
    where.rowOff.toFixed(1) +
    ' px';
  const where = measureWhere();
  check(
    where.shown && where.oneLine && where.sameHeight && where.sameWidth && where.fontSame,
    'This folder / Own worktree: each on one line, equal halves, the type of the tools'
  );
  check(
    Math.abs(where.segHeight - where.chipHeight) < 0.5 && where.labelOff < 1 && where.rowOff < 1,
    'the switch is as tall as a tool, its label on its center line, the row centered (' +
      whereText(where) +
      ')'
  );
  await shot('thread-start-dark');

  // a press on another usable tool chooses it, the same way the picker under the prompt does
  const other = usable().find(tool => tool.getAttribute('aria-pressed') !== 'true');
  if (other) {
    const want = other.dataset.key.split('|')[0];
    other.click();
    await wait(300);
    check(
      live.newAgent() === want &&
        island.querySelector('.tnt-start-tool[aria-pressed="true"]')?.dataset.key ===
          other.dataset.key,
      'a press on ' + want + ' chooses it for the next prompt'
    );
    check(
      document.activeElement === document.getElementById('prompt'),
      'and the keyboard goes to the prompt box'
    );
    usable()[0].click();
    await wait(200);
  } else log.push('note only one tool can start on this PC: choosing another is not checked');

  // One ground, no hard cuts: the screen paints no fill and draws no line of its own.
  const ground = getComputedStyle(start());
  const noLine = ['Top', 'Right', 'Bottom', 'Left'].every(
    side => parseFloat(ground['border' + side + 'Width']) === 0
  );
  check(
    /rgba\(0, 0, 0, 0\)|transparent/.test(ground.backgroundColor) &&
      ground.backgroundImage === 'none' &&
      noLine,
    'the screen has no fill and no line of its own (' + ground.backgroundColor + ')'
  );

  // The chosen tool follows the accent picker; the ground does not.
  const chosen = () => island.querySelector('.tnt-start-tool[aria-pressed="true"]');
  const accentBefore = getComputedStyle(chosen()).borderTopColor;
  const groundBefore = getComputedStyle(document.documentElement).getPropertyValue('--pg-bg');
  window.TnaiTheme?.setAccent?.('teal');
  await wait(300);
  check(
    getComputedStyle(chosen()).borderTopColor !== accentBefore &&
      getComputedStyle(document.documentElement).getPropertyValue('--pg-bg') === groundBefore,
    'in Teal the chosen tool takes the new accent and the ground stays'
  );
  await shot('thread-start-teal');
  window.TnaiTheme?.setAccent?.('purple');
  await wait(200);

  // the same screen in Light, for a picture; the look is put back at once
  const look = window.TnaiTheme?.get?.() === 'light' ? 'light' : 'dark';
  window.TnaiTheme?.set('light');

  // the prompt box repaints its worktree label on a new look too, so it is unhidden again
  if (worktreeLabel) worktreeLabel.hidden = false;
  window.TnaiThreadStart?.paint?.();
  await shot('thread-start-light');
  window.TnaiTheme?.set(look);

  start().querySelector('.tnt-start-cancel').click();
  await wait(300);
  check(
    !live.newAgent() && !shown(start()) && shown(island.querySelector('.tnt-head')),
    'Cancel turns New thread off and the thread is back'
  );

  newButton().click();
  await wait(300);
  listRow(shell)?.click();
  await wait(400);
  check(
    !live.newAgent() && !shown(start()) && view().shown() === shell,
    'a press on a thread in the list while the screen shows opens it and ends New thread'
  );

  // ---- in a small window ----
  await main('size', 1024, 700);
  await wait(600);
  newButton().click();
  await wait(400);
  const islandBox = box(island);
  const outside = [...start().querySelectorAll('button, h2')].filter(el => {
    const part = box(el);
    return shown(el) && (part.left < islandBox.left - 1 || part.right > islandBox.right + 1);
  });
  check(
    shown(start()) && overlaps(start()).length === 0 && outside.length === 0,
    'small window: nothing overlaps and nothing stands outside the island'
  );

  // the prompt box repaints its worktree label on a new size, so it is unhidden again
  if (worktreeLabel) worktreeLabel.hidden = false;
  window.TnaiThreadStart?.paint?.();
  await wait(200);
  const smallWhere = measureWhere();
  check(
    smallWhere.oneLine && smallWhere.sameHeight && smallWhere.labelOff < 1,
    'small window: This folder / Own worktree still one line each (' + whereText(smallWhere) + ')'
  );
  await shot('thread-start-small');
  restoreWorktree();
  live.newAgent(false);
  await main('size', 1440, 900);
  await wait(500);

  // ---- the on/off button ----
  const power = () => island.querySelector('.tnt-head-power');
  const menuButton = () => island.querySelector('.tnt-head-menu');
  const confirmBox = () => document.querySelector('.tnai-panel-confirm-box');
  check(
    shown(power()) && menuButton().previousElementSibling === power(),
    'the on/off button stands just before "..."'
  );
  check(
    power().getAttribute('aria-label') === 'Stop this agent',
    'it offers Stop while the thread runs'
  );
  const powerBox = box(power());
  const moreBox = box(menuButton());
  check(
    Math.abs(powerBox.height - moreBox.height) < 1 &&
      Math.abs(powerBox.top - moreBox.top) < 1 &&
      moreBox.left - powerBox.right >= 0,
    'it has the size and line of "..." and does not touch it'
  );
  power().click();
  const asked = await until(() => confirmBox(), 3000);
  check(!!asked && sessionOf(shell)?.running === true, 'a press asks first');
  await shot('thread-start-power');
  asked?.querySelector('.tnai-ws-close-confirm').click();
  check(
    !!(await until(() => sessionOf(shell) && !sessionOf(shell).running, 8000)),
    'confirmed, it stops the thread'
  );
  check(
    !!(await until(() => power().getAttribute('aria-label') === 'Start this agent again', 3000)),
    'and then offers Start'
  );
  power().click();
  check(
    !!(await until(() => sessionOf(shell)?.running, 10000)),
    'a press on Start starts it again'
  );

  // ---- a right press on a thread in the list ----
  const menu = () => document.querySelector('.tnt-menu-thread');
  listRow(shell).dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
  );
  check(
    !!(await until(() => shown(menu()), 3000)) && view().shown() === shell,
    'a right press on a thread opens it with its menu'
  );
  window.TnaiThreadMore?.close();
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
restoreWorktree();
window.TnaiThreadMore?.close();
live?.newAgent?.(false);
for (const paneId of opened) await agents.stop(paneId).catch(() => {});
await main('cleanup').catch(() => {});
await main('size', 1440, 900).catch(() => {});
return { ok, log };
