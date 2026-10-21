/*
 * Technically Not tools · desktop-check/tests/agent-talk.js — Agents messaging each other, shown
 * on their thread rows (11 onMesh/talkLine, 119): two real PowerShell panels dressed as agents,
 * mesh-out / mesh-in pushed on the agent:event channel. Both rows get "· ↔ NAME", the row's
 * tooltip holds the last message each way, a failed send adds nothing, a third peer turns it into
 * "↔ 2 agents", an old message (past the 3 min fade) shows nothing, and the hidden old grid of 11
 * builds no cards.
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
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};
const go = async view => {
  view === 'overview' ? window.TnaiThreads.open() : window.TnaiRoute(view);
  await wait(350);
};

// The agent's row in the thread list (119): "· ↔ NAME" ends its tool part, the messages are in the
// row's tooltip. (The old Overview cards of 11 that showed it are no longer built.)
const row = id => document.querySelector('.tnt-th[data-pane="' + CSS.escape(id) + '"]');
const now = id => ({
  textContent: row(id)?.querySelector('.tnt-th-tool')?.textContent || '',
  title: row(id)?.title || '',
});

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

const realSessions = window.TnaiAgents.sessions;
try {
  const a = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  const b = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  check(
    !!(await until(() => realSessions().filter(s => s.running).length >= 2)),
    '2 real shells started'
  );
  const dress = {
    [a]: { agent: 'Claude Code', name: 'Juniper', status: 'working' },
    [b]: { agent: 'Codex', name: 'Otter', status: 'waiting' },
  };
  window.TnaiAgents.sessions = () =>
    realSessions().map(s =>
      dress[s.paneId] ? { ...s, ...dress[s.paneId], lastOutputAt: Date.now() - 3000 } : s
    );
  await go('overview');
  await until(() => row(a) && row(b));
  check(
    !/↔/.test(now(a).textContent) && !/↔/.test(now(b).textContent),
    'no messages yet: no ↔ on either row'
  );

  // A stale message from long ago (past the fade) shows nothing.
  await main('emit', {
    kind: 'mesh-out',
    paneId: a,
    to: 'Codex · Otter',
    text: 'old news',
    at: Date.now() - 200000,
  });
  await wait(400);
  check(!/↔/.test(now(a).textContent), 'a message older than 3 min shows nothing');

  // A failed send adds nothing (53's feed shows failures).
  await main('emit', {
    kind: 'mesh-out',
    paneId: a,
    to: 'Codex · Otter',
    text: 'Not delivered: it is not running',
    at: Date.now(),
  });
  await wait(400);
  check(!/↔/.test(now(a).textContent), 'a failed send shows no ↔');

  // Juniper → Otter and Otter's reply: both cards show the peer, tooltips hold each direction.
  await main('emit', {
    kind: 'mesh-out',
    paneId: a,
    to: 'Codex · Otter',
    text: 'Take the calendar component; I keep the form.',
    at: Date.now(),
  });
  await main('emit', {
    kind: 'mesh-in',
    paneId: b,
    from: 'Claude Code · Juniper',
    text: 'Take the calendar component; I keep the form.',
    at: Date.now(),
  });
  await main('emit', {
    kind: 'mesh-out',
    paneId: b,
    to: 'Claude Code · Juniper',
    text: 'OK, calendar is mine.',
    at: Date.now(),
  });
  await main('emit', {
    kind: 'mesh-in',
    paneId: a,
    from: 'Codex · Otter',
    text: 'OK, calendar is mine.',
    at: Date.now(),
  });
  check(
    !!(await until(
      () => /↔ Otter/.test(now(a).textContent) && /↔ Juniper/.test(now(b).textContent),
      3000
    )),
    'both rows show the peer: "' + now(a).textContent + '" / "' + now(b).textContent + '"'
  );
  const tipA =
    (await until(() => {
      const t = now(a).title;
      return /→ Take the calendar/.test(t) && /← OK, calendar is mine/.test(t) && t;
    }, 3000)) || now(a).title;
  check(
    /→ Take the calendar/.test(tipA) && /← OK, calendar is mine/.test(tipA),
    'tooltip holds the last message each way'
  );

  // 11 no longer builds the old Overview's hidden cards (speed lead 8): none is in the page.
  check(
    !document.querySelector('.tnai-live-sessions .tnai-card'),
    'the hidden old grid has no cards while agents talk'
  );
  await shot('talk-two');

  // A third peer: one short count, not a list.
  await main('emit', {
    kind: 'mesh-in',
    paneId: a,
    from: 'Claude Code · Maple',
    text: 'I need the form props.',
    at: Date.now(),
  });
  check(
    !!(await until(() => /↔ 2 agents/.test(now(a).textContent), 3000)),
    'two peers read "↔ 2 agents"'
  );
  check(/Maple/.test(now(a).title) && /Otter/.test(now(a).title), 'tooltip lists both peers');

  // An interrupt (tnai intervene): the live tasks keep who stopped it for a few seconds, then the
  // note is gone. (The old Agent Tree row that showed it, 94, is deleted and no thread view shows
  // the note yet, so what is checked is what 11 keeps: `TnaiLiveTasks.interrupted`.)
  window.TnaiThreads.open();
  await wait(500);
  await main('emit', {
    kind: 'mesh-in',
    paneId: a,
    from: 'Claude Code · Maple',
    text: 'Interrupted its task: stop, that file is mine',
    interrupt: true,
    at: Date.now(),
  });
  const kept = await until(() => window.TnaiLiveTasks.interrupted(a), 3000);
  check(
    kept?.by === 'Maple' && /stop, that file is mine/.test(kept?.text || ''),
    'interrupted agent: the live tasks name who stopped it and keep the message (' +
      JSON.stringify(kept) +
      ')'
  );

  // The note has a place a user sees: the agent's row in the thread list says who stopped it.
  const rowNow = () =>
    document.querySelector('.tnt-th[data-pane="' + CSS.escape(a) + '"] .tnt-th-now')?.textContent ||
    '';
  check(
    !!(await until(() => /Interrupted by Maple/.test(rowNow()), 3000)),
    'its row in the thread list says "Interrupted by Maple" (' + rowNow() + ')'
  );
  await shot('agent-talk-interrupted');
  check(
    !!(await until(() => window.TnaiLiveTasks.interrupted(a) === null, 12000)),
    'the note is gone after a few seconds'
  );
  check(
    !!(await until(() => !/Interrupted by/.test(rowNow()), 3000)),
    'and the row says what the agent does again (' + rowNow() + ')'
  );
  await main('emit', {
    kind: 'mesh-in',
    paneId: a,
    from: 'Claude Code · Maple',
    text: 'a normal message',
    at: Date.now(),
  });
  await wait(600);
  check(
    window.TnaiLiveTasks.interrupted(a) === null,
    'a normal message does not show as an interrupt'
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + error.stack.split('\n')[1]);
}
window.TnaiAgents.sessions = realSessions;
realSessions().forEach(s => window.TnaiAgents.stop(s.paneId));
await until(() => !realSessions().some(s => s.running), 5000);
await wait(300);
return { ok, log };
