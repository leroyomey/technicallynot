/*
 * * Technically Not tools · desktop-check/tests/handoff-history.js — Agent handoff made visible
 * * (102-handoff-history.js over 54's real retire() steps), with PowerShell panes standing in for
 * * agents (no agent CLI launched; the successor start and the handoff message are stubbed in the
 * * window only): never handed off mid-turn; a 200k hand-off limit with "Without asking: Retire"
 * * hands off at 210k and not at 190k; the old agent's status is "Handing off → <new>", the new
 * one's
 * * "Taking over" until its first finished turn; the history entry fields (reason, before → after,
 * * task, summary, results link); the dialog opens from the Handoff history button in the top row
 * of
 * * the agent's thread (120) and from Ctrl+K, closes with Esc / outside click; a failed handoff
 * keeps
 * * the old agent with "Handoff failed" + reason. Moved 2026-10-12 from the old Overview: the Agent
 * * Tree row's status words, its ↪ marker and the tree's ? menu went with that page, and the status
 * * words and the marker have no place in the thread list yet (read here from TnaiHandoffHistory).
 * Settings › Agents takes 200000, shows the
 * * context hint and fits at 1024 and 768 wide. Screenshots at 1440×900 and 1180×760. Returns {ok,
 * * log}.
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
    await wait(50);
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
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(500);
};
const U = window.TnaiContextUpkeep,
  H = window.TnaiHandoffHistory,
  G = window.TnaiAgents,
  N = window.tnaiNative;
const report = extra =>
  'Done.\n\nTechnically Not report\n- Did: tidied the settings page\n' + (extra || '');
const nameOf = id => G.sessions().find(s => s.paneId === id)?.name || '';

// The agent's own thread, shown as "Go to this agent" shows it.
const thread = async id => {
  window.TnaiThreads.show(id);
  await wait(400);
};
const headButton = () => document.querySelector('.tnt-head-handoff');
const dlg = () => document.querySelector('.tnai-hoh-overlay');
const realStart = window.TnaiTeam?.startLead,
  realSend = G.send;
const opened = [];
const sent = [];
try {
  check(
    !!U && !!H && !!N.handoffs,
    'TnaiContextUpkeep, TnaiHandoffHistory and tnaiNative.handoffs present'
  );
  await main('reset');
  window.TnaiThreads.open();
  await wait(300);
  U.set({
    on: true,
    idle: 0,
    skip: [],
    compact: 400000,
    clear: 600000,
    never: true,
    age: 0,
    handoff: 200000,
    auto: 'retire',
  });
  const a = await window.TnaiTest.open('Terminal');
  opened.push(a?.paneId);
  check(a?.ok, 'old agent (PowerShell stand-in) opened');
  const A = a.paneId,
    nameA = nameOf(A);

  // The successor starts as another PowerShell panel; the handoff message is recorded instead of
  // typed.
  window.TnaiTeam.startLead = async () => {
    const r = await window.TnaiTest.open('Terminal');
    if (r?.paneId) opened.push(r.paneId);
    return r?.ok ? { paneId: r.paneId, name: nameOf(r.paneId) } : { error: 'test: no panel' };
  };
  G.send = (paneId, text) => {
    sent.push({ paneId, text });
    return Promise.resolve({ ok: true });
  };
  const phases = [];
  const onPhase = e => {
    const d = e.detail;
    phases.push({
      phase: d.phase,
      old: H.status(d.paneId)?.text || '',
      neu: d.to?.paneId ? H.status(d.to.paneId)?.text || '' : '',
    });
  };
  window.addEventListener('tnai:handoff', onPhase);

  // Never mid-turn: a working agent past the limit is left alone.
  await main('start', A, nameA, 250000);
  await wait(600);
  check(
    U.why(A) === 'the agent is working' && !U.pending().length && !phases.length,
    'mid-turn at 250k: no handoff (' + U.why(A) + ')'
  );

  // Below the 200k limit: nothing.
  await main('finish', A, nameA, report(), 190000);
  await wait(800);
  check(
    !U.pending().length && !phases.length && !H.list().length,
    '190k (below the 200k hand-off limit): no handoff'
  );

  // At 210k with "Without asking: Retire": it hands off by itself.
  await main('finish', A, nameA, report('- Next: add a keyboard shortcut\n'), 210000);
  const e1 = await until(() => H.list().find(e => e.result === 'ok'), 10000);
  check(!!e1, '210k with Retire: handed off (' + JSON.stringify(phases) + ')');
  const B = e1?.to?.paneId,
    nameB = e1?.to?.name;
  check(
    phases.some(p => p.phase === 'start' && p.old === 'Handing off…') &&
      phases.some(
        p => p.phase === 'started' && p.old === 'Handing off → ' + nameB && p.neu === 'Taking over'
      ),
    'status texts: "Handing off…", "Handing off → ' + nameB + '", "Taking over"'
  );
  check(
    !!e1 &&
      e1.from.name === nameA &&
      e1.from.paneId === A &&
      !!B &&
      B !== A &&
      e1.agent === 'Claude Code' &&
      e1.reason?.kind === 'context' &&
      e1.reason.n === 200000 &&
      e1.before === 210000 &&
      e1.after === null &&
      /upkeep test/.test(e1.task) &&
      /^[0-9a-f]{8}$/.test(e1.entryId) &&
      e1.summary.did.some(x => /tidied the settings page/.test(x)) &&
      e1.summary.next.some(x => /keyboard shortcut/.test(x)) &&
      e1.id.startsWith(A + ':'),
    'history entry: from/to, CLI, reason context limit 200k, before 210k, after unknown, task, result id, summary (' +
      JSON.stringify(e1) +
      ')'
  );
  check(
    sent.some(
      s =>
        s.paneId === B &&
        /you take over from/.test(s.text) &&
        /"Done:", "Where we stopped:" and "Still open:"/.test(s.text) &&
        /- Decide: Is this hand-off summary right\?/.test(s.text) &&
        /Start no work until the user answers/.test(s.text)
    ),
    "the handoff message went to the new agent, asking for a summary and the user's confirmation"
  );
  check(
    !!(await until(
      () => !document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(A) + '"]'),
      3000
    )),
    'old panel closed'
  );
  const stored = await main('stored');
  check(
    stored.handoffs.length === 1 &&
      stored.handoffs[0].id === e1.id &&
      stored.handoffs[0].chain === e1.id,
    'stored in the main process, one entry, own chain'
  );

  // The new agent's status is "Taking over" until it confirms.
  await thread(B);
  check(
    H.status(B)?.text === 'Taking over',
    'new agent: status "Taking over" (' + JSON.stringify(H.status(B)) + ')'
  );
  await main('size', 1440, 900);
  await wait(300);
  await shot('handoff-thread-taking-over-1440');
  await main('finish', B, nameB, report(), 18000);
  await wait(900);
  const e1b = H.list().find(e => e.id === e1.id);
  check(
    !H.status(B) && e1b?.after === 18000 && e1b.confirmedAt > 0,
    'confirmed: normal status again, after = 18k (first reported reading)'
  );

  // The Handoff history button in the top row of the agent's thread opens the history at that
  // agent's own chain. Where it is counts too: inside the window, nothing lying over it.
  await thread(B);
  const head = headButton(),
    hr = head?.getBoundingClientRect(),
    over = hr && document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
  check(
    window.TnaiThreads.selected() === B &&
      !!head &&
      head.offsetParent !== null &&
      hr.width > 0 &&
      hr.left >= 0 &&
      hr.right <= innerWidth &&
      hr.top >= 0 &&
      over?.closest('.tnt-head-handoff') === head &&
      /Handoff history/.test(head.getAttribute('aria-label') || ''),
    'the thread of the agent that took over has the Handoff history button, with a spoken label and nothing over it (' +
      (hr && Math.round(hr.left) + ',' + Math.round(hr.top) + ' ' + hr.width + '×' + hr.height) +
      ')'
  );
  head.click();
  await wait(300);
  check(
    !dlg().hidden && window.TnaiThreads.selected() === B,
    'the button opens the history, and the thread stays the open one'
  );
  const txt = () => dlg().textContent;
  check(
    /1 handoff this week · usually at ~210k, new agent starts at ~18k/.test(txt()),
    'top line: ' + dlg().querySelector('.tnai-hoh-top').textContent
  );
  check(
    new RegExp(nameA + ' → ' + nameB).test(txt()) &&
      /Claude Code/.test(txt()) &&
      /Reason: context limit 200k · Context 210k → 18k/.test(txt()) &&
      /Task: .*upkeep test/.test(txt()) &&
      /took over ✓/.test(txt()) &&
      /Summary handed over/.test(txt()) &&
      /Open its results/.test(txt()),
    'entry: from → to, CLI, reason, context before → after, task, result, summary, results link'
  );
  dlg().querySelector('details').open = true;
  check(
    /Done/.test(dlg().querySelector('details').textContent) &&
      /Next steps/.test(dlg().querySelector('details').textContent),
    'summary folds open: done / next steps'
  );
  dlg().querySelector('.tnai-hoh-res').click();
  check(
    !!(await until(
      () => /Final answer/.test(dlg().querySelector('.tnai-hoh-raw')?.textContent || ''),
      3000
    )),
    'Open its results shows the saved result (as tnai context show)'
  );
  await shot('handoff-history-1440');
  await main('size', 1180, 760);
  await wait(300);
  const m = dlg().querySelector('.tnai-hoh').getBoundingClientRect();
  check(
    m.top >= 0 &&
      m.bottom <= innerHeight &&
      m.left >= 0 &&
      m.right <= innerWidth &&
      dlg().querySelector('.tnai-hoh-list').scrollWidth <=
        dlg().querySelector('.tnai-hoh-list').clientWidth + 1,
    'dialog fits at 1180×760, no sideways scroll'
  );
  await shot('handoff-history-1180');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);
  check(dlg().hidden, 'Esc closes');

  // From the button once more, then a click outside closes.
  headButton().click();
  await wait(250);
  check(!dlg().hidden, 'the button opens it again');
  dlg().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(150);
  check(dlg().hidden, 'click outside closes');

  // From Ctrl+K.
  window.TnaiPalette.open();
  await wait(200);
  const inp = document.querySelector('.tnai-pal-overlay input');
  inp.value = 'Handoff history';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(250);
  const pal = [...document.querySelectorAll('.tnai-pal-item')].find(b =>
    /Handoff history/.test(b.textContent)
  );
  check(!!pal, 'Ctrl+K lists "Handoff history"');
  pal?.click();
  await wait(250);
  check(!dlg().hidden, 'Ctrl+K entry opens it');
  H.close();

  // A failed handoff (manual Retire): the old agent stays, "Handoff failed" in the Problem color
  // with the reason on hover.
  U.set({ auto: '' });
  window.TnaiTeam.startLead = async () => ({ error: 'test: the successor could not start' });
  await main('finish', B, nameB, report(), 220000);
  await until(() => U.pending().find(p => p.paneId === B), 3000);
  window.TnaiNextActions?.openBell(true);
  document
    .querySelector(
      '.tnai-bell-pop [data-item="notice:upkeep:' + CSS.escape(B) + '"] [data-a="retire"]'
    )
    ?.click();
  const e2 = await until(() => H.list().find(e => e.result === 'failed'), 5000);
  await thread(B);
  check(
    !!e2 &&
      e2.reason.kind === 'manual' &&
      e2.before === 220000 &&
      /could not start/.test(e2.error) &&
      e2.chain === e1.id,
    'failed entry: manual Retire, 220k, reason kept, same chain as ' +
      nameB +
      "'s takeover (" +
      JSON.stringify(e2 && { r: e2.reason, chain: e2.chain }) +
      ')'
  );
  check(
    !!document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(B) + '"]') &&
      /^Handoff failed/.test(H.status(B)?.text || '') &&
      /could not start/.test(JSON.stringify(H.status(B))),
    'old agent stays: status "Handoff failed" with the reason (' + JSON.stringify(H.status(B)) + ')'
  );
  await shot('handoff-thread-failed-1180');
  await main('size', 1440, 900);
  await wait(300);
  await shot('handoff-thread-failed-1440');
  H.open(B);
  await wait(200);
  check(
    dlg().querySelectorAll('.tnai-hoh-e').length === 2 &&
      /failed, old kept/.test(dlg().textContent) &&
      new RegExp(nameA + ' → ' + nameB).test(dlg().querySelector('.tnai-hoh-chain h3').textContent),
    'chain shows both entries, newest first'
  );
  H.close();
  await main('start', B, nameB, 5000);
  await wait(400);
  check(!H.status(B), 'its next turn clears "Handoff failed"');

  // Settings › Agents: the hint line, 200000 accepted, fits at 1024 and 768 wide.
  window.TnaiSettings.open('agents');
  await wait(300);
  document.querySelector('#settingsPanel-agents [data-sa-sec="context"]')?.click();
  await wait(200);
  const set = document.querySelector('#settingsPanel-agents .tnai-upkeep-set');
  check(
    /Only Claude Code, Codex and OpenCode report their context, so only they are handed off\./.test(
      set?.textContent || ''
    ),
    'Settings hint: only Claude Code, Codex and OpenCode are handed off'
  );
  const hi = set.querySelector('[data-k=handoff]');
  hi.value = '200000';
  hi.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(100);
  check(U.prefs().handoff === 200000 && hi.value === '200000', 'Hand off at accepts 200000');
  for (const [w, h] of [
    [1024, 768],
    [768, 700],
  ]) {
    await main('size', w, h);
    await wait(300);
    set.querySelector('[data-k=handoff]').scrollIntoView({ block: 'center' });
    await wait(150);
    const card = set.querySelector('.set-card').getBoundingClientRect();
    const bad = [...set.querySelectorAll('.set-row')].filter(r => {
      const b = r.getBoundingClientRect();
      return b.width && (b.right > card.right + 1 || b.left < card.left - 1);
    }).length;
    const ctl = ['handoff', 'age']
      .map(k => set.querySelector(`[data-k=${k}]`).getBoundingClientRect())
      .concat(
        [...set.querySelectorAll('[data-k=auto]')].map(r =>
          r.closest('label').getBoundingClientRect()
        )
      );
    if (bad || !ctl.every(b => b.width > 0 && b.right <= card.right + 1))
      log.push(
        '     card ' +
          JSON.stringify(card) +
          ' ctl ' +
          JSON.stringify(ctl.map(b => [b.left, b.right, b.width]))
      );
    check(
      !bad && card.right <= innerWidth && ctl.every(b => b.width > 0 && b.right <= card.right + 1),
      'context upkeep row fits at ' + w + ' wide (hand off, age, Without asking)'
    );
    await shot('handoff-settings-' + w);
  }
  U.set({
    handoff: 150000,
    age: 2,
    auto: '',
    on: true,
    compact: 400000,
    clear: 600000,
    never: true,
    idle: 3,
  });
  window.removeEventListener('tnai:handoff', onPhase);
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
if (realStart) window.TnaiTeam.startLead = realStart;
G.send = realSend;
for (const id of opened)
  if (id)
    try {
      G.stop(id);
    } catch {}
return { ok, log };
