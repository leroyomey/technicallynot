/*
 * Technically Not tools · desktop-check/tests/next-actions.js — After an agent finishes
 * (51-next-actions.js), against the real context store (fed by next-actions.main.js; nothing is
 * launched, no prompt is sent): by default a finished agent only goes to the bell (no popup); Pop
 * up next steps puts a card above the composer with the result's did/blockers/next steps; Edit in
 * composer fills the prompt without sending; Continue automatically never sends a step that waits
 * on the user or comes from an agent that isn't running, and says why on the card; Off shows
 * nothing; Settings › Agents has the mode. Returns {ok, log}.
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
const N = window.TnaiNextActions,
  card = () => document.querySelector('.tnai-next');
const report = (next, blockers) =>
  'Done.\n\nTechnically Not report\n- Did: added the theme toggle\n' +
  (blockers ? '- Blockers: ' + blockers + '\n' : '') +
  '- Next: ' +
  next +
  '\n';
try {
  check(
    !!N && N.mode() === 'off',
    'TnaiNextActions present, default: nothing pops up (finished agents wait in the bell)'
  );
  window.TnaiThreads.open();
  await wait(250);
  await main('finish', 'na-pane-0', 'Ash', '[TN.ai] Quiet default', report('check the bell'));
  const bell0 = await until(() => {
    const b = document.querySelector('header.top .tnai-bell');
    return +b?.querySelector('.n-count')?.textContent >= 1 && b;
  }, 6000);
  check(
    !!bell0 && card().hidden,
    'default: a finished agent with next steps goes to the bell, unread, and no card pops up'
  );
  N.dismiss(N.pending()[0]);
  N.setMode('suggest'); // Pop up next steps on for the card checks below

  await main(
    'finish',
    'na-pane-1',
    'Wren',
    '[TN.ai] Add a theme toggle',
    report('document the toggle in the README; add a keyboard shortcut')
  );
  const c = await until(() => !card().hidden && card());
  check(
    !!c && c.classList.contains('chip'),
    'a new card starts as a one-line chip (compact default)'
  );
  const chip1 = c?.querySelector('.tnai-nitem.chip[data-act="expand"]');
  check(!!chip1 && /Wren finished/.test(chip1.textContent), 'chip: avatar and name');
  check(
    /Next: document the toggle/.test(chip1?.querySelector('small')?.textContent || ''),
    'chip: one-line next step'
  );
  check(!chip1?.querySelector('[data-act="send"]'), 'chip: no Send button (Wren is not running)');
  check(!!chip1?.querySelector('[data-act="dismiss"]'), 'chip: dismiss ✕');
  console.log('TNAI_SHOT:next-actions-chip');
  await wait(450);

  chip1.click();
  await wait(100);
  check(!card().classList.contains('chip'), 'clicking the chip expands the full card');
  check(
    !!c &&
      /Wren finished/.test(c.textContent) &&
      /added the theme toggle/.test(c.textContent) &&
      c.querySelectorAll('.n-steps li').length === 2,
    'card: who finished, what it did, two next steps'
  );
  check(
    c?.querySelector('[data-act="send"]').disabled,
    'Send to Wren is disabled: Wren is not running (nothing faked)'
  );
  console.log('TNAI_SHOT:next-actions-card');
  await wait(450);
  c.querySelector('[data-act="collapse"]').click();
  await wait(100);
  check(card().classList.contains('chip'), 'collapse ▾ returns to the chip');
  c.querySelector('[data-act="expand"]').click();
  await wait(100);

  const prompt = document.getElementById('prompt');
  prompt.value = '';
  c.querySelector('[data-act="compose"][data-i="1"]').click();
  await wait(100);
  check(
    /add a keyboard shortcut/.test(prompt.value) && card().hidden,
    'Edit in composer puts the step in the prompt (not sent) and closes the card'
  );
  prompt.value = '';

  N.set({ compact: false }); // full card for the auto-mode / decision content checks below
  N.setMode('auto', 3);
  await main(
    'finish',
    'na-pane-2',
    'Moss',
    '[TN.ai] Fix the build script',
    report('build the .exe when you ask')
  );
  await until(() => !card().hidden, 6000);
  check(
    /waits on you/.test(card().textContent),
    'auto: a step that waits on the user is not sent; the card says why (' +
      (card().querySelector('.n-why')?.textContent || '') +
      ')'
  );
  N.dismiss(N.pending()[0]);
  await main(
    'finish',
    'na-pane-3',
    'Fern',
    '[TN.ai] Tidy the styles',
    report('split the stylesheet', 'blocked until you approve deleting the old cache')
  );
  await until(() => !card().hidden, 6000);
  check(
    /reported blockers/.test(card().textContent) &&
      /approve deleting the old cache/.test(card().textContent),
    'auto: blockers pause it and are shown'
  );
  N.dismiss(N.pending()[0]);
  await main(
    'finish',
    'na-pane-4',
    'Sage',
    '[TN.ai] Rename the helper',
    report('update the call sites')
  );
  await until(() => !card().hidden, 6000);
  check(
    /is not running/.test(card().textContent),
    'auto: an agent that is not running is never sent to; the card says so'
  );
  N.dismiss(N.pending()[0]);

  N.set({ hold: 'README' });
  await main('finish', 'na-pane-8', 'Pine', '[TN.ai] Docs pass', report('update the README'));
  await until(() => !card().hidden, 6000);
  check(
    /waits on you/.test(card().textContent) && !N.counting().length,
    'auto: the user’s own pause words hold a step back'
  );
  N.dismiss(N.pending()[0]);
  N.set({ hold: '', skip: ['claude-code'] });
  await main('finish', 'na-pane-9', 'Birch', '[TN.ai] Lint', report('fix the lint warnings'));
  await until(() => !card().hidden, 6000);
  check(
    /off for/.test(card().textContent),
    'auto: a CLI switched off in Settings is never auto-sent to (' +
      (card().querySelector('.n-why')?.textContent || '') +
      ')'
  );
  N.dismiss(N.pending()[0]);
  N.set({ skip: [] });

  // A decision: shown on the card (recommended option first, Send disabled while the agent is not
  // running) and automatic mode pauses on it.
  await main(
    'finish',
    'na-pane-10',
    'Elm',
    '[TN.ai] Pick a router',
    'Compared.\n\nTechnically Not report\n- Did: compared routers\n- Next: wire the router\n- Decide: Which router? | 1. Hash router | 2. History router (recommended)'
  );
  await until(() => !card().hidden, 6000);
  const dsec = card().querySelector('.n-sec[data-k="choices"]');
  check(
    /Elm needs your decision/.test(card().querySelector('.n-why')?.textContent || '') &&
      !N.counting().length,
    'auto: a card with a decision is never auto-continued (' +
      (card().querySelector('.n-why')?.textContent || '') +
      ')'
  );
  check(
    !!dsec &&
      /Which router\?/.test(dsec.textContent) &&
      /^History router/.test(dsec.querySelector('li')?.textContent || '') &&
      !!dsec.querySelector('li .tnai-rec') &&
      dsec.querySelector('[data-act="decide"]').disabled &&
      /Decision needed/.test(card().querySelector('.n-tag')?.textContent || ''),
    'card: Decision needed tag, recommended option first, Send disabled (Elm is not running)'
  );
  const other = dsec?.querySelector('.n-other');
  check(
    !!other &&
      dsec.querySelectorAll('li').length === 3 &&
      !!other.querySelector('input[placeholder]') &&
      other.querySelector('[data-act="decide"][data-i="other"]').disabled,
    'card: a "Something else" reply row after the options, Send disabled while Elm is not running'
  );
  console.log('TNAI_SHOT:next-actions-decision');
  await wait(450);

  // Status (71): an agent with an open decision shows "Needs your decision"; Elm is not running, so
  // its own decision counts only through a stand-in.
  const NY = window.TnaiNeedsYou,
    realDeciding = N.deciding;
  check(
    N.deciding('na-pane-10') === null,
    'status: a decision of a stopped agent does not make it Needs you'
  );
  if (NY) {
    N.deciding = p => (p === 'na-pane-10' ? { question: 'Which router?', options: [] } : null);
    check(
      NY.has('na-pane-10') &&
        NY.label('na-pane-10') === 'Needs your decision · Which router?' &&
        !NY.has('na-pane-9'),
      'status: an open decision → "Needs your decision · <question>" (' +
        NY.label('na-pane-10') +
        ')'
    );
    N.deciding = realDeciding;
  }
  N.dismiss(N.pending()[0]);

  N.setMode('off');
  await main('finish', 'na-pane-5', 'Reed', '[TN.ai] Small fix', report('run the tests'));
  await wait(2500);
  check(card().hidden, 'Off: no card');
  N.setMode('suggest');
  N.set({ compact: true }); // back to the chip default before the stack test

  // Several finishes stack on the card (newest open, the rest as rows) and all go to the bell.
  await main('finish', 'na-pane-6', 'Ivy', '[TN.ai] Add search', report('add a clear button'));
  await main(
    'finish',
    'na-pane-7',
    'Oak',
    '[TN.ai] Fix the footer',
    report('check dark mode', 'the footer test is flaky')
  );
  await until(() => N.pending().length === 2, 6000);
  const chipStack = card();
  check(
    chipStack.classList.contains('chip') &&
      /\+1/.test(chipStack.querySelector('.n-more')?.textContent || ''),
    'stacked chip shows +1'
  );
  chipStack.querySelector('[data-act="expand"]').click();
  await wait(100);
  const sc = card();
  check(
    /2 agents finished/.test(sc.textContent) &&
      sc.querySelectorAll('.tnai-nitem.row').length === 1 &&
      /Oak finished/.test(sc.querySelector('.tnai-nitem:not(.row)')?.textContent || ''),
    'stack: newest (Oak) open, the other as a row'
  );
  check(
    !!sc.querySelector('.tnai-nitem:not(.row) .agent-avatar.has-ico svg'),
    'card shows the CLI icon'
  );
  console.log('TNAI_SHOT:next-actions-stack');
  await wait(450);
  sc.querySelector('.tnai-nitem.row').click();
  await wait(80);
  check(
    /Ivy finished/.test(card().querySelector('.tnai-nitem:not(.row)')?.textContent || ''),
    'clicking a stacked row opens it'
  );
  const bell = document.querySelector('header.top .tnai-bell');
  check(
    !!bell && +bell.querySelector('.n-count').textContent >= 2,
    'bell counts unread finished agents (' + bell?.querySelector('.n-count').textContent + ')'
  );
  bell.click();
  await wait(120);
  const pop = document.querySelector('.tnai-bell-pop');
  check(
    !pop.hidden &&
      pop.querySelectorAll('.tnai-nitem').length >= 2 &&
      /Oak finished/.test(pop.textContent) &&
      /Ivy finished/.test(pop.textContent),
    'bell lists every finished agent, newest first'
  );
  console.log('TNAI_SHOT:next-actions-bell');
  await wait(450);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(50);
  check(
    pop.hidden && bell.querySelector('.n-count').hidden,
    'Esc closes the bell and marks all read'
  );
  N.pending().forEach(N.dismiss);

  // Tuck: a chip left untouched for prefs.tuck seconds flies into the bell and stays unread there.
  N.set({ tuck: 1 });
  await main('finish', 'na-pane-11', 'Cedar', '[TN.ai] Format code', report('run prettier'));
  await until(() => !card().hidden, 6000);
  const tid = N.pending()[0];
  check(!!tid && card().classList.contains('chip'), 'tuck: new card is a chip');
  const tucked = await until(() => !N.pending().includes(tid), 3000);
  check(!!tucked, 'tuck: an untouched chip leaves N.pending() within ~3s (tuck=1)');
  check(
    +bell.querySelector('.n-count').textContent >= 1,
    'tuck: still unread in the bell after tucking (' +
      bell.querySelector('.n-count').textContent +
      ')'
  );
  N.dismiss(tid);
  N.set({ tuck: 45 });

  // Put away: a card whose next step a later result reports done (automatic upkeep) leaves the
  // stack and the bell at once.
  await main(
    'finish',
    'na-pane-12',
    'Aspen',
    '[TN.ai] Write the changelog',
    report('publish the changelog page on the website')
  );
  const hid = await until(() => N.pending()[0]);
  check(!!hid && /Aspen/.test(card().textContent), 'handled: Aspen card shows with its next step');
  await main(
    'finish',
    'na-pane-13',
    'Birch',
    '[TN.ai] Changelog page',
    'Done.\n\nTechnically Not report\n- Did: added and published the changelog page on the website\n'
  );
  check(
    !!(await until(() => !N.pending().includes(hid), 6000)),
    "handled: Birch reporting the step done puts Aspen's card away automatically"
  );
  N.openBell(true);
  check(
    !!(await until(() => !pop.querySelector(`[data-item="${hid}"]`), 3000)),
    "handled: Aspen's item leaves the bell at once, even while it is open"
  );
  const brow = () =>
      [...pop.querySelectorAll('.tnai-nitem')].find(r => /Birch finished/.test(r.textContent)),
    bid = brow()?.dataset.item;
  brow()?.click();
  await wait(100);
  check(
    !!bid &&
      !pop.querySelector(`.tnai-nitem.row[data-item="${bid}"]`) &&
      !!pop.querySelector(`[data-item="${bid}"] .n-head[data-act=collapse]`),
    'bell: clicking a row expands it'
  );
  pop.querySelector(`[data-item="${bid}"] .n-head[data-act=collapse] .n-who`)?.click();
  await wait(100);
  check(
    !!pop.querySelector(`.tnai-nitem.row[data-item="${bid}"]`),
    "bell: clicking an open item's header collapses it back to a row"
  );
  N.openBell(false);
  N.pending().forEach(N.dismiss);

  // Closed: an agent whose panel was closed no longer waits on the user; its item leaves the bell
  // at once like other handled items.
  await main(
    'finish',
    'na-pane-40',
    'Cedar',
    '[TN.ai] Cedar task',
    report('post the release notes')
  );
  const cid = await until(() => N.pending()[0]);
  N.openBell(true);
  check(
    /next step/i.test(
      (await until(() => pop.querySelector(`[data-item="${cid}"] .n-tag`)))?.textContent || ''
    ),
    'closed: before closing, Cedar waits with a next step'
  );
  window.dispatchEvent(
    new CustomEvent('tnai:terminal-pane-closed', { detail: { paneId: 'na-pane-40' } })
  );
  const cgone = await until(() => !pop.querySelector(`[data-item="${cid}"]`), 3000);
  check(
    !!cgone && !N.pending().includes(cid),
    "closed: closing Cedar's panel removes its item from the open bell and puts its card away"
  );
  N.openBell(false);

  // Nudge: unread and untouched for prefs.nudge seconds → the count pulses a few beats; one that
  // needs an answer (blockers) pulses non-stop; opening the bell stops it.
  const bellMd = document.querySelector('header.top .tnai-bell');

  // Not focused: a keyboard-focused control's title is parked by the hover tips (83) and read as ''
  // here.
  document.activeElement?.blur?.();
  N.set({ nudge: 1 });
  await main('finish', 'na-pane-14', 'Cedar', '[TN.ai] Nudge plain', report('tidy the README'));
  check(
    !!(await until(() => +bellMd.querySelector('.n-count').textContent >= 1)) &&
      !bellMd.classList.contains('n-attn'),
    'nudge: a fresh unread item does not pulse yet'
  );
  check(
    !!(await until(() => bellMd.classList.contains('n-attn'), 3000)) &&
      !bellMd.classList.contains('n-attn-loop'),
    'nudge: after the wait the count pulses a few beats (not non-stop)'
  );
  await main(
    'finish',
    'na-pane-15',
    'Dune',
    '[TN.ai] Nudge blocked',
    report('retry the upload', 'needs your API key')
  );
  check(
    !!(await until(() => bellMd.classList.contains('n-attn-loop'), 3000)) &&
      /needs your answer/.test(bellMd.title),
    'nudge: an unread item with blockers pulses non-stop (' + bellMd.title + ')'
  );
  console.log('TNAI_SHOT:next-actions-nudge');
  await wait(450);
  N.openBell(true);
  await wait(50);
  check(
    !bellMd.classList.contains('n-attn') && !bellMd.classList.contains('n-attn-loop'),
    'nudge: opening the bell stops the pulse'
  );
  N.openBell(false);
  await wait(1300);
  check(
    !bellMd.classList.contains('n-attn-loop') && bellMd.querySelector('.n-count').hidden,
    'nudge: closing marks all read, no pulse comes back'
  );
  N.set({ nudge: 120 });
  N.pending().forEach(N.dismiss);

  // Blocked only when the agent can't continue without the user; notes stay inside the card; the
  // same blocker shows once; moving on clears it.
  const tagFor = id => {
    N.openBell(true);
    const t =
      document.querySelector(`.tnai-bell-pop [data-item="${id}"] .n-tag`)?.textContent || '';
    N.openBell(false);
    return t;
  };
  const newest = async name =>
    (await window.tnaiNative.context.state()).entries.find(e => e.name === name)?.id;
  await main(
    'finish',
    'na-pane-16',
    'Elm',
    '[TN.ai] Soft notes',
    report('polish the header', 'not tested by hand; the lint check failed')
  );
  await wait(300);
  const soft = await newest('Elm');
  check(
    /next step/i.test(tagFor(soft)) && bellMd.querySelector('.n-count').dataset.k !== 'blocked',
    'blockers: "not tested by hand" / "check failed" are notes, tagged Next steps, count not orange (' +
      tagFor(soft) +
      ')'
  );
  await main(
    'finish',
    'na-pane-17',
    'Fir',
    '[TN.ai] Upload A',
    report('retry', 'needs your API key for the upload service')
  );
  await main(
    'finish',
    'na-pane-18',
    'Gum',
    '[TN.ai] Upload B',
    report('retry', 'needs your API key for the upload service')
  );
  await wait(300);
  const dupOld = await newest('Fir'),
    dupNew = await newest('Gum');
  check(
    tagFor(dupNew) === 'Blocked' && tagFor(dupOld) !== 'Blocked',
    'blockers: the same blocker from two agents shows once (' +
      tagFor(dupOld) +
      ' / ' +
      tagFor(dupNew) +
      ')'
  );
  await main('finish', 'na-pane-18', 'Gum', '[TN.ai] Something else', report('tidy up'));
  await wait(300);
  check(
    tagFor(dupNew) !== 'Blocked',
    'blockers: cleared once the same agent moved on (' + tagFor(dupNew) + ')'
  );
  N.pending().forEach(N.dismiss);

  // Notices (60): same item markup, unread, open shows text + action, same key is not repeated,
  // unnotify removes it.
  let ran = 0;
  N.notify({
    key: 'test-cli',
    source: 'Codex',
    title: 'Codex 9.9.9 is available',
    text: 'Installed: 0.1.0. Update with `npm i -g @openai/codex@latest`.',
    action: {
      label: 'Open Terminal',
      run: () => {
        ran++;
      },
    },
  });
  N.notify({
    key: 'test-cli',
    source: 'Codex',
    title: 'Codex 9.9.9 is available',
    text: 'Installed: 0.1.0. Update with `npm i -g @openai/codex@latest`.',
    action: {
      label: 'Open Terminal',
      run: () => {
        ran++;
      },
    },
  });
  check(
    bellMd.querySelector('.n-count').textContent === '1' &&
      typeof window.tnaiNative.cliUpdates?.state === 'function',
    'notice: counts once as unread; tnaiNative.cliUpdates bridge present'
  );
  N.openBell(true);
  await wait(50);
  const nrow = document.querySelector('.tnai-bell-pop [data-item="notice:test-cli"]');
  check(
    !!nrow &&
      !!nrow.querySelector('.agent-avatar.has-ico[data-cli="codex"]') &&
      /Notifications/.test(document.querySelector('.tnai-bell-pop .n-pophead b').textContent),
    'notice: listed in the bell with the CLI icon, header Notifications'
  );
  check(
    !!document.querySelector('.tnai-bell-pop [data-item="notice:test-cli"] .n-ic'),
    'notice: opened first (unread) and shows its text with the command'
  );
  document.querySelector('.tnai-bell-pop [data-item="notice:test-cli"] [data-act=notice]').click();
  await wait(50);
  check(
    ran === 1 && document.querySelector('.tnai-bell-pop').hidden,
    'notice: its action runs and closes the bell'
  );
  N.unnotify('test-cli');
  N.openBell(true);
  await wait(50);
  check(
    !document.querySelector('.tnai-bell-pop [data-item="notice:test-cli"]'),
    'notice: unnotify removes it'
  );
  N.openBell(false);

  // ✓ Mark done / Mark all done / looking at the agent's terminal marks it read
  N.setMode('off');
  await main(
    'finish',
    'na-pane-8',
    'Iris',
    '[TN.ai] Write the FAQ',
    report('add a pricing question')
  );
  await main(
    'finish',
    'na-pane-9',
    'Juno',
    '[TN.ai] Fix the footer',
    report('check the footer links')
  );
  const fake = Object.assign(document.createElement('div'), { tabIndex: 0 });
  fake.dataset.paneId = 'na-pane-8';
  document.body.append(fake);
  const unreadN = () => +bellMd.querySelector('.n-count').textContent || 0;
  await until(() => unreadN() >= 2, 6000);
  const u0 = unreadN();
  fake.focus();
  await wait(50);

  // A window the OS hasn't focused (a background test window on Linux/WSLg) moves focus without
  // firing focusin: deliver the event focus() would have.
  if (!document.hasFocus()) {
    log.push('     note: window not focused, focusin dispatched by hand');
    fake.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await wait(50);
  }
  check(
    unreadN() === u0 - 1,
    'focusing the agent terminal marks its notification read (' + u0 + ' → ' + unreadN() + ')'
  );
  fake.remove();
  N.openBell(true);
  await wait(50);
  const irisRow = () =>
    document.querySelector('.tnai-bell-pop [data-item] .n-who b') &&
    [...document.querySelectorAll('.tnai-bell-pop .tnai-nitem')].find(r =>
      /Iris finished/.test(r.textContent)
    );
  check(
    !!irisRow()?.querySelector('[data-act="done"]'),
    'bell row: ✓ Mark done on an item with open next steps'
  );
  irisRow().querySelector('[data-act="done"]').click();
  await until(() => !irisRow(), 2000);
  check(!irisRow(), '✓ marks it done: the item leaves the open bell at once');
  const st = await window.tnaiNative.context.state();
  const iris = (st.entries || []).find(e => e.name === 'Iris');
  check(
    !!iris && st.marks?.[iris.id + ':next:0']?.state === 'done',
    '✓ marks the open step done in Project context'
  );
  const doneAll = () => document.querySelector('.tnai-bell-pop [data-act="done-all"]');
  check(
    !!doneAll() && !doneAll().disabled,
    'bell header: Mark all done is enabled while items wait on you'
  );
  doneAll().click();
  await until(() => doneAll()?.disabled, 4000);
  check(!!doneAll()?.disabled, 'Mark all done: nothing waits on you afterwards (button disabled)');
  N.openBell(false);
  N.setMode('suggest'); // back to what the Settings checks below expect

  // Close steps when an agent moves on: an older report's step on a pane that reported again gets
  // dismissed in Project context (setting off: untouched)
  await main('finish', 'na-pane-10', 'Kite', '[TN.ai] Draft the intro', report('add a screenshot'));
  await main(
    'finish',
    'na-pane-10',
    'Kite',
    '[TN.ai] Shorten the intro',
    report('trim the last line')
  );
  const kiteOld = async () => {
    const st = await window.tnaiNative.context.state();
    const k = (st.entries || []).filter(e => e.name === 'Kite').sort((a, b) => a.at - b.at)[0];
    return st.marks?.[k?.id + ':next:0']?.state;
  };
  await wait(400);
  check(!(await kiteOld()), 'moved on, setting off: the older step stays open in Project context');
  N.set({ closeMovedOn: true });
  await N.refresh();
  check(
    await until(async () => (await kiteOld()) === 'dismissed', 4000),
    'moved on, setting on: the older step is dismissed in Project context'
  );
  N.set({ closeMovedOn: false });

  window.TnaiSettings.open('accounts');
  await wait(600);
  check(
    !!document.querySelector(
      '#tnaiAccountsMount .agent-avatar.has-ico[data-cli="claude-code"] svg'
    ),
    'Settings › Accounts: Claude Code card shows its icon'
  );
  console.log('TNAI_SHOT:settings-cli-icons');
  await wait(450);

  window.TnaiSettings.open('agents');
  await wait(200);
  const set = document.querySelector('#settingsPanel-agents .tnai-next-set');
  check(
    !!set &&
      set.querySelector('[data-k=cards]').checked &&
      !set.querySelector('[data-k=auto]').checked &&
      set.querySelectorAll('[data-cli]').length === 7 &&
      !!set.querySelector('[data-k=delay]'),
    'Settings › Agents (cards ' +
      set?.querySelector('[data-k=cards]')?.checked +
      ', auto ' +
      set?.querySelector('[data-k=auto]')?.checked +
      ', CLIs ' +
      set?.querySelectorAll('[data-cli]').length +
      '): manual cards and Automatic mode side by side, with delay, limit, CLIs'
  );
  check(
    set.querySelector('[data-k=compact]').checked &&
      set.querySelector('[data-k=tuck]').value === '45',
    'Settings › Agents: Start small (compact) on by default, tuck 45s'
  );
  console.log('TNAI_SHOT:next-actions-settings');
  await wait(450);
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
return { ok, log };
