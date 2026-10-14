/*
 * * Technically Not tools · desktop-check/tests/held-go-to.js — "Go to it" on the "Prompt held"
 * card
 * * (71) pressed with a real mouse (TNAI_INPUT), from the Threads page, for an agent in each place
 * it can be:
 * * a panel of the shown workspace, a panel of another workspace tab, and a panel that is gone.
 * Each
 * * press must end somewhere true: that agent's thread open on the Threads page, or, with no
 * * panel to show, the Agents page. Also checks the card keeps its buttons when the keyboard moves
 * * (a press that moves the keyboard to the button must not lose its click). Uses real PowerShell
 * * panels; nothing is sent to them. Returns {ok, log}.
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

// Real mouse events through Chromium's input pipeline (run.js sends them one after another).
const input = events =>
  new Promise(resolve => {
    const id = 'i' + ++callId;
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    window.__tnaiInputDone[id] = () => {
      delete window.__tnaiInputDone[id];
      resolve();
    };
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });

// A real press moves the keyboard to the pressed button, and the page hears focusout and focusin.
// A test window is never focusable, so it hears neither: they are sent here on every mouse press,
// as the app's own window would get them.
let focusEventsSent = 0;
document.addEventListener(
  'mousedown',
  () => {
    if (document.hasFocus()) return;
    focusEventsSent++;
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  },
  true
);

// A press held for 90 ms, as a hand does it, in the middle of the element.
const press = async element => {
  const box = element.getBoundingClientRect(),
    x = box.left + box.width / 2,
    y = box.top + box.height / 2;
  await input([
    { type: 'mouseMove', x, y },
    { type: 'mouseDown', x, y, wait: 90 },
    { type: 'mouseUp', x, y },
  ]);
};

const nav = view => (view === 'overview' ? window.TnaiThreads.open() : window.TnaiRoute(view));
const card = document.querySelector('.tnai-perm.tnai-held');
const goButton = () => card.querySelector('button[data-act="go"]');
const held = [];

// One "Prompt held" card for that panel, shown while the user is on Overview.
const holdFor = async (paneId, label) => {
  document.activeElement?.blur?.();
  nav('overview');
  await wait(500);
  const heldId = await main('hold', paneId);
  held.push({ paneId, heldId });
  const shown = await until(() => !card.hidden && goButton(), 4000);
  check(!!heldId && !!shown, label + ': the "Prompt held" card shows with "Go to it"');
};

// Where the press ended: the Threads page, with that agent's thread open (Go to this agent opens
// the thread, not a spotlighted terminal panel).
const landedOn = (paneId, label) => {
  check(window.TnaiThreads.visible(), label + ': the Threads page is shown');
  check(String(window.TnaiThreads.selected()) === String(paneId), label + ': its thread is open');
};

try {
  // Underneath, the threads' panels stand in groups; the app opens the next group when one is
  // full. One thread in the active group, one in a second group made the way the app makes it.
  const groups = window.TnaiTerminalWorkspaces;
  const firstId = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  check(!!firstId, 'group 1: shell started as a thread');
  const otherGroup = groups.overflow({ activate: false });
  await wait(300);
  const record = window.TnaiNewTerminalPane({ workspaceId: otherGroup, quiet: true });
  await wait(0);
  const secondId = record?.id || '';
  check(
    !!secondId && secondId !== firstId && groups.activeId() !== otherGroup,
    'group 2: a panel of its own, and group 1 is still the active one'
  );
  const second = secondId ? await window.TnaiAgents.openIn(secondId, 'Terminal', {}) : null;
  check(!!second?.ok, 'group 2: shell started as a thread');

  // The first real press of a test may only wake the window: one on a harmless spot first.
  nav('overview');
  await wait(400);
  const spot = document.createElement('div');
  spot.style.cssText = 'position:fixed;left:50%;top:2px;width:24px;height:6px;z-index:99999';
  document.body.append(spot);
  await press(spot);
  spot.remove();
  await wait(200);

  // --- The card keeps its buttons when the keyboard moves ---
  await holdFor(firstId, 'active group');
  const before = goButton();
  document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await wait(150);
  check(
    before.isConnected && goButton() === before,
    'the keyboard moved: "Go to it" is still the same button (a press in progress keeps its click)'
  );

  // --- A panel of the shown workspace ---
  await press(goButton());
  await wait(700);
  landedOn(firstId, 'active group');
  await main('cleanup', firstId, held[0].heldId);
  await until(() => card.hidden, 3000);

  // --- A panel of another workspace tab ---
  await holdFor(secondId, 'another group');
  await press(goButton());
  await wait(700);
  landedOn(secondId, 'another group');
  await main('cleanup', secondId, held[1].heldId);
  await until(() => card.hidden, 3000);
  log.push('focus events sent for presses: ' + focusEventsSent);

  // --- No thread to show (its panel is closed, or on a workspace with no tab): the Threads page,
  // never nothing. The Agents and history page is out of the app. Asked from another page, so
  // the change of page is seen.
  const onThreads = () =>
    window.TnaiThreads.visible() &&
    !document.querySelector('.layout').classList.contains('agents-mode');
  nav('skills');
  await wait(400);
  window.TnaiNeedsYou.jump('no-such-panel');
  await wait(500);
  check(onThreads(), 'no thread: the Threads page is shown instead of nothing');

  // The stuck-loop notice's "Go to it" (85) goes the same way.
  nav('skills');
  await wait(400);
  window.TnaiLiveTasks.focusPane('no-such-panel');
  await wait(500);
  check(onThreads(), 'no thread, asked through focusPane: the Threads page is shown');

  window.TnaiAgents.sessions().forEach(s => s.running && window.TnaiAgents.stop(s.paneId));
  await until(() => !window.TnaiAgents.sessions().some(s => s.running), 10000);
} catch (e) {
  check(false, 'threw: ' + (e?.stack || e));
}
for (const h of held) await main('cleanup', h.paneId, h.heldId).catch(() => {});
await wait(300);
check(card.hidden, 'cleanup: no card left');
return { ok, log };
