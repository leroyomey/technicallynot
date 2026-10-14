/*
 * Technically Not tools · desktop-check/tests/agent-teams.js — Team mode end to end (88 +
 * desktop/agent-teams.js + `tnai team` in agent-mesh.js/agent-shim.js), with the FAKE `claude` CLI
 * from agent-mesh.main.js (no real CLI, no credits): two agents started separately; an agent's own
 * `tnai team A B` is refused; the Team row of a thread's "..." menu opens the dialog, Save groups
 * them, both rows of the thread list name the team, `tnai team` in an agent lists its teammate;
 * `tnai team off NAME` typed in a plain terminal panel ends the team and the rows drop it; one
 * prompt to both offers the team once; on a team the dialog offers Leave team. File-lock sharing
 * itself: node tools/desktop-check/file-lock-check.js.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const deadline = Date.now() + 150000;
const until = async (fn, ms = 10000) => {
  const end = Math.min(deadline, Date.now() + ms);
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(60);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const N = window.tnaiNative,
  G = window.TnaiAgents;
const strip = s =>
  String(s || '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '');
const text = async paneId => strip((await N.pty.replay(paneId))?.buffer);
const session = paneId => G.sessions().find(s => s.paneId === paneId);
const has = (paneId, re, ms = 15000) => until(async () => re.test(await text(paneId)), ms);
const type = (paneId, line) => N.pty.write(paneId, line + '\r');
const { bin } = await main('paths');
const windows = /Windows/.test(navigator.userAgent);

async function shell() {
  const r = await window.TnaiTest.open('Terminal');
  await until(async () => (await text(r.paneId)).includes(windows ? '>' : '$'), 20000);
  await until(() => Date.now() - (session(r.paneId)?.lastOutputAt || 0) > 1200, 8000);
  if (!windows) {
    type(r.paneId, 'export PATH="${TNAI_SHIM%/*}:' + bin + ':$PATH"');
    await wait(300);
  }
  return r.paneId;
}

async function agent() {
  const id = await shell();
  type(id, 'claude');
  check(await until(() => session(id)?.agent === 'Claude Code'), 'fake claude registers in ' + id);
  await until(
    () => (window.TnaiMesh?.state?.() || []).some(m => m.paneId === id && m.project),
    8000
  );
  return id;
}
const A = await agent(),
  B = await agent();
const nameA = session(A).name,
  nameB = session(B).name;
await wait(400); // 37 publishes the panel names to main

// An agent cannot make a team.
type(A, 'tnai team ' + nameA + ' ' + nameB);
check(await has(A, /Only the user sets teams/), "an agent's own `tnai team A B` is refused");
check(!(await N.teams.state()).teams.length, 'no team after the refused command');

// The user's entry: the Team row of the thread's own "..." menu (137).
const menuButton = () => window.TnaiThreads.slot('main').querySelector('.tnt-head-menu');
const openedMenu = () => document.querySelector('.tnt-menu-thread:not([hidden])');
const teamDialog = () => document.querySelector('[role="dialog"][aria-labelledby="tnaiTeamTitle"]');

// Opens A's thread and its menu, and gives the menu's Team row.
const openMenu = async () => {
  window.TnaiThreads.open();
  window.TnaiThreads.select(A);
  await until(() => window.TnaiThreadHelpers.state().pane === A && menuButton(), 4000);
  if (!openedMenu()) menuButton().click();
  return until(() => openedMenu()?.querySelector('.tnt-menu-row[data-row="team"]'), 3000);
};
const closeMenu = () => {
  if (openedMenu()) menuButton().click();
};
const firstRow = await openMenu();
check(
  !!firstRow && firstRow.textContent === 'Team',
  'Team row in the thread’s "..." menu, with no team yet (' + firstRow?.textContent + ')'
);
firstRow?.click();
const dlg = await until(teamDialog);
const boxes = [...(dlg?.querySelectorAll('input[type="checkbox"]') || [])],
  box = boxes.find(b => b.value === B);
check(
  !!box && boxes.length === 1,
  'dialog lists the other agent in this project (' +
    boxes.map(b => b.value).join() +
    ' / ' +
    B +
    ')'
);
if (box) box.checked = true;
await wait(300);
console.log('TNAI_SHOT:agent-teams-dialog');
await wait(500);
dlg?.querySelector('[data-choice="save"]')?.click();
check(
  await until(async () =>
    (await N.teams.state()).teams.some(t => t.panes.includes(A) && t.panes.includes(B))
  ),
  'Save groups the two agents in main'
);
{
  // The row is drawn at every opening of the menu, so the menu is opened again to read it.
  let label = '';
  let whole = false;
  const named = await until(async () => {
    const row = await openMenu();
    label = row?.textContent || '';
    whole = !!row && row.scrollWidth <= row.clientWidth;
    if (label === 'Team · 2 agents') return true;
    closeMenu();
    return false;
  }, 6000);
  check(!!named, 'the Team row names the team ("Team · 2 agents": ' + label + ')');
  check(whole, 'the longer Team label fits its row');
  await wait(300);
  console.log('TNAI_SHOT:agent-teams-menu');
  await wait(500);
  closeMenu();
}

// The thread list names the team on both rows (119): the row's tooltip.
const tip = id =>
  document.querySelector('.tnt-th[data-pane="' + CSS.escape(id) + '"]')?.title || '';
const onTeam = id => /Team: with /.test(tip(id));
check(await until(() => onTeam(A) && onTeam(B)), 'both threads name their team in the thread list');
check(
  tip(A).includes('Team: with ' + nameB) && tip(B).includes('Team: with ' + nameA),
  'each row’s tooltip names the teammate (' +
    tip(A)
      .split('\n')
      .find(line => line.startsWith('Team:')) +
    ')'
);

// The agent sees its team.
type(B, 'tnai team');
check(
  await has(B, new RegExp('Your team \\(set by the user\\): you \\+ ' + nameA)),
  '`tnai team` in an agent lists its teammate'
);

// The user ends it from a plain terminal panel.
const T = await shell();
type(T, 'tnai team off ' + nameA);
check(await has(T, /Off their team/), '`tnai team off NAME` in a plain terminal panel is accepted');
check(await until(async () => !(await N.teams.state()).teams.length), 'the team ended');
check(await until(() => !onTeam(A) && !onTeam(B)), 'the thread list no longer names a team');

// One composer prompt to both (@mentions) offers the team, once; only Save makes it.
const P = document.getElementById('prompt'),
  sent = [],
  realSend = G.send;
G.send = (paneId, t) => {
  sent.push(paneId);
  return true;
}; // the offer only needs the send to succeed
const ask = async () => {
  window.TnaiRoute?.('overview');
  await wait(150);
  P.focus();
  P.value = '@' + nameA + ', @' + nameB + ': compare notes';
  P.dispatchEvent(new Event('input', { bubbles: true }));
  P.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => sent.length >= 2);
  sent.length = 0;
  await wait(300);
  return document.querySelector('[role="dialog"][aria-labelledby="tnaiTeamTitle"]');
};
let offer = await ask();
check(
  !!offer &&
    /one prompt to/.test(offer.querySelector('p').textContent) &&
    [...offer.querySelectorAll('input')].some(i => i.value === B && i.checked),
  'a prompt to both offers the team with the other agent checked'
);
offer?.querySelector('[data-choice="save"]').click();
check(
  await until(async () =>
    (await N.teams.state()).teams.some(t => t.panes.includes(A) && t.panes.includes(B))
  ),
  'Save on the offer groups them'
);
check(!(await ask()), 'no offer while they are already one team');
await N.teams.set(A, []);
await until(async () => !(await N.teams.state()).teams.length);
offer = await ask();
check(!!offer, 'offered again once the team ended');
offer?.querySelector('[data-choice="cancel"]').click();
await wait(200);
check(
  !(await N.teams.state()).teams.length && !(await ask()),
  'Cancel makes no team and the same pair is not asked again'
);
G.send = realSend;

// On a team, the same Team row opens the box with Leave team.
await N.teams.set(A, [B]);
await until(async () =>
  (await N.teams.state()).teams.some(t => t.panes.includes(A) && t.panes.includes(B))
);
(await openMenu())?.click();
const leave = (await until(teamDialog))?.querySelector('[data-choice="leave"]');
check(
  !!leave && !leave.hidden && leave.textContent === 'Leave team',
  'on a team: the dialog offers Leave team'
);
leave?.click();
check(
  await until(async () => !(await N.teams.state()).teams.length),
  'Leave team ends it in one click'
);

for (const p of [A, B]) type(p, 'quit');
await wait(300);
return { ok, log };
