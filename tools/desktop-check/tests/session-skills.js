/*
 * Technically Not tools · desktop-check/tests/session-skills.js — Skills given to a running agent
 * (101): "Give for" This task (default) / Whole session, a this-task skill ending by itself when
 * its task's turn finishes normally (nothing sent then; the next prompt carries one "stop
 * following" line), Clear all with one message, and the popup's controls. The agent is a stand-in:
 * TnaiAgents.sessions/send and TnaiTurns.get are wrapped so 101's real code runs against a fake
 * running Claude Code panel (no CLI started, no usage spent). Not covered: a real Claude Code turn
 * ending.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(25);
  }
  return null;
};
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};
const S = window.TnaiSessionSkills,
  PANE = 'standin-pane';
check(
  !!S && typeof S.detachAll === 'function' && typeof S.scope === 'function',
  'TnaiSessionSkills has detachAll and scope'
);
try {
  localStorage.removeItem('tnai.session-skills-scope.v1');
  localStorage.removeItem('tnai.session-skills.v1');
} catch {}

for (const n of ['task-skill-a', 'task-skill-b'])
  await window.TnaiSkills.import({
    files: [
      {
        name: 'SKILL.md',
        text:
          '---\nname: ' +
          n +
          '\ndescription: Stand-in skill ' +
          n +
          ' for the session-skills check.\n---\nSay ' +
          n +
          '.\n',
      },
    ],
  });
check(
  !!(await until(() =>
    ['task-skill-a', 'task-skill-b'].every(id => window.TnaiSkills.list().some(k => k.id === id))
  )),
  'two skills in the library'
);

// Stand-in running Claude Code session.
const sent = [],
  fake = {
    paneId: PANE,
    name: 'Standin',
    agent: 'Claude Code',
    running: true,
    startedAt: 4242,
    status: 'idle',
  };
const realSessions = window.TnaiAgents.sessions,
  realSend = window.TnaiAgents.send,
  realTurn = window.TnaiTurns.get;
window.TnaiAgents.sessions = (...a) => [...realSessions.apply(window.TnaiAgents, a), fake];
window.TnaiAgents.send = (id, message, ...rest) =>
  id === PANE
    ? (sent.push(String(message)), true)
    : realSend.call(window.TnaiAgents, id, message, ...rest);
let turn = null;
window.TnaiTurns.get = id => (id === PANE ? (turn ? { ...turn } : null) : realTurn(id));
const pushTurn = t => {
  turn = t;
  window.dispatchEvent(new CustomEvent('tnai:turn', { detail: { paneId: PANE } }));
};
const names = () =>
  S.list(PANE)
    .map(k => k.name + ':' + k.scope)
    .join(',');

try {
  check(
    S.scope() === 'task' && S.refusal(PANE) === '',
    'default is This task; the stand-in can take skills'
  );

  // This task: the message says one task, the prompt note arms it, a normal turn end takes it off
  // without a message.
  check(
    (await S.attach(PANE, 'task-skill-a')) === true &&
      sent.length === 1 &&
      /for one task/.test(sent[0]) &&
      /task-skill-a/.test(sent[0]) &&
      !/rest of this session/.test(sent[0]),
    'attach for this task: one message saying one task'
  );
  check(names() === 'task-skill-a:task', 'recorded with scope task');

  // Loaded number on the Skills button: attached + on for every session + picked up by itself, each
  // name once; what it used stays after 13 clears it.
  const L1 = S.loaded(PANE),
    realUsed = window.TnaiFileActivity?.skills;
  check(
    L1.attached.join() === 'task-skill-a' &&
      L1.total === 1 + L1.always.length + L1.used.length &&
      S.chipsHtml(PANE, { button: true }).includes('<i>' + L1.total + '</i>'),
    'Skills button shows the loaded total (' +
      L1.total +
      ': 1 attached, ' +
      L1.always.length +
      ' every session, ' +
      L1.used.length +
      ' used)'
  );
  if (window.TnaiFileActivity) {
    window.TnaiFileActivity.skills = id =>
      id === PANE
        ? [
            { name: 'plug:seen-standin', at: 1 },
            { name: 'plug:task-skill-a', at: 2 },
          ]
        : realUsed.call(window.TnaiFileActivity, id);
    window.dispatchEvent(new CustomEvent('tnai:skill-activity'));
    window.TnaiFileActivity.skills = realUsed;
    const L2 = S.loaded(PANE);
    check(
      L2.total === L1.total + 1 &&
        L2.used.includes('plug:seen-standin') &&
        !L2.used.includes('plug:task-skill-a'),
      'a skill it picked up by itself adds one and stays counted; the attached one is not counted twice (' +
        L2.total +
        ')'
    );
    const off = { ...fake, running: false };
    window.TnaiAgents.sessions = (...a) => [...realSessions.apply(window.TnaiAgents, a), off];
    check(S.loaded(PANE).total === 0, 'a session that is not running has nothing loaded');
    window.TnaiAgents.sessions = (...a) => [...realSessions.apply(window.TnaiAgents, a), fake];
  }
  pushTurn({ startedAt: Date.now() - 500, endedAt: Date.now(), endedBy: 'stop' });
  check(
    names() === 'task-skill-a:task',
    'not armed yet (no prompt sent): a turn ending (its own acknowledgement) leaves it on'
  );
  const n1 = S.note(PANE);
  check(
    /for this task only: task-skill-a\./.test(n1) && !/for this session/.test(n1),
    'prompt note names it as this task only'
  );
  await wait(20);
  pushTurn({ startedAt: Date.now(), endedAt: 0 });
  check(names() === 'task-skill-a:task', 'still on while its task runs');
  pushTurn({ startedAt: turn.startedAt, endedAt: Date.now() + 5, endedBy: 'interrupted' });
  check(names() === 'task-skill-a:task', 'still on after an interrupt');
  const before = sent.length;
  pushTurn({ startedAt: turn.startedAt, endedAt: Date.now() + 10, endedBy: 'stop' });
  check(
    names() === '' && sent.length === before,
    'task finished: skill off by itself, nothing sent to the agent'
  );
  const n2 = S.note(PANE),
    n3 = S.note(PANE);
  check(
    /The skill task-skill-a was for an earlier task only\. Stop following it\./.test(n2) &&
      n3 === '',
    'next prompt carries one stop line, the one after carries none'
  );

  // Popup: Give for + Whole session.
  const anchor = document.createElement('button');
  anchor.type = 'button';
  anchor.textContent = 'Skills';
  anchor.style.cssText = 'position:fixed;top:80px;right:340px;z-index:9001';
  document.body.append(anchor);
  S.open(anchor, PANE);
  await frame();
  const pop = document.querySelector('.tn-skp');
  const pick = how => pop.querySelector('[data-skl-scope="' + how + '"]');
  check(
    !pop.hidden &&
      pick('task')?.getAttribute('aria-pressed') === 'true' &&
      pick('session')?.getAttribute('aria-pressed') === 'false' &&
      /Give for/.test(pop.querySelector('.tn-skp-scope')?.textContent || ''),
    'popup shows Give for with This task pressed'
  );
  check(!pop.querySelector('[data-skl-clear]'), 'no Clear all with nothing attached');
  pick('session').click();
  await frame();
  check(
    S.scope() === 'session' &&
      localStorage.getItem('tnai.session-skills-scope.v1') === 'session' &&
      pick('session').getAttribute('aria-pressed') === 'true' &&
      document.activeElement === pick('session'),
    'Whole session picked, remembered, focus kept on it'
  );
  check(
    /Stays with this agent until its session ends/.test(
      pop.querySelector('.tn-skp-foot')?.textContent || ''
    ),
    'footer explains Whole session'
  );
  const s0 = sent.length;
  pop.querySelector('.tn-skp-item[data-skill-id="task-skill-a"]').click();
  await until(() => S.list(PANE).length === 1);
  check(
    sent.length === s0 + 1 &&
      /rest of this session/.test(sent[s0]) &&
      names() === 'task-skill-a:session',
    'clicking a card gives it for the whole session'
  );
  await S.attach(PANE, 'task-skill-b', 'task');
  await frame();
  check(
    names() === 'task-skill-a:session,task-skill-b:task',
    'a second skill for this task beside it'
  );
  const n4 = S.note(PANE);
  check(
    /for this session: task-skill-a\./.test(n4) && /for this task only: task-skill-b\./.test(n4),
    'prompt note lists both kinds'
  );
  await wait(20);
  pushTurn({ startedAt: Date.now(), endedAt: Date.now() + 10, endedBy: 'stop' });
  check(names() === 'task-skill-a:session', 'task finished: only the this-task skill ended');
  await S.attach(PANE, 'task-skill-b', 'session');
  await frame();

  // Clear all: one message for both.
  const clear = await until(() => pop.querySelector('[data-skl-clear]'), 2000);
  const chips = pop.querySelectorAll('.tn-skp-have .tn-skl-chip').length;
  check(
    !!clear && chips === 2 && /Clear all/.test(clear.textContent),
    'Clear all shown with two skills attached'
  );
  const fits = el => {
    const r = el.getBoundingClientRect(),
      p = pop.getBoundingClientRect();
    return (
      r.width > 0 && r.left >= p.left && r.right <= p.right + 0.5 && r.bottom <= p.bottom + 0.5
    );
  };
  check(
    [clear, pick('task'), pick('session')].every(fits) && pop.scrollWidth <= pop.clientWidth,
    'new controls sit inside the popup, no sideways overflow'
  );
  await shot('session-skills-popup');
  const s1 = sent.length;
  pop.querySelector('[data-skl-clear]').click();
  await frame(); // asked again: a repaint may have replaced the button since `clear` was read
  check(
    names() === '' &&
      sent.length === s1 + 1 &&
      /task-skill-a/.test(sent[s1]) &&
      /task-skill-b/.test(sent[s1]) &&
      /Stop following them/.test(sent[s1]),
    'Clear all: both off with one message'
  );
  check(
    !pop.querySelector('[data-skl-clear]') &&
      /None yet/.test(pop.querySelector('.tn-skp-have')?.textContent || ''),
    'popup back to None yet'
  );
  check(S.note(PANE) === '', 'no note after Clear all');

  pick('task').click();
  await frame();
  check(
    S.scope() === 'task' &&
      /Ends by itself/.test(pop.querySelector('.tn-skp-foot')?.textContent || ''),
    'back to This task; footer explains it'
  );
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await frame();
  check(
    pop.hidden && document.activeElement === anchor,
    'Escape closes the popup and returns focus to its button'
  );
  anchor.remove();
} finally {
  window.TnaiAgents.sessions = realSessions;
  window.TnaiAgents.send = realSend;
  window.TnaiTurns.get = realTurn;
  try {
    localStorage.removeItem('tnai.session-skills-scope.v1');
    localStorage.removeItem('tnai.session-skills.v1');
  } catch {}
}
return { ok, log };
