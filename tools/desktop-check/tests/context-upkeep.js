/*
 * Technically Not tools · desktop-check/tests/context-upkeep.js — Context upkeep suggestions
 * (54-context-upkeep.js) against the real Project Context store, with finished turns carrying a
 * context size fed by context-upkeep.main.js for a PowerShell pane (so no agent CLI ever gets a
 * command): nothing happens when the setting is off, the context size is unknown, Project Context
 * has no entry after the last turn, prompts are queued, the result has blockers or a decision, or
 * the agent hasn't been idle long enough; the command follows the thresholds (/compact, /clear only
 * when no next step is open); the notice asks and never runs by itself; Not now stops it; Run types
 * /compact into the pane and records it; a finished /compact (smaller size pushed for the same
 * turn) closes the notice. Settings › Agents has the section. Returns {ok, log}.
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
const U = window.TnaiContextUpkeep,
  G = window.TnaiAgents,
  N = window.tnaiNative;

// The offer is a bell item now: open the bell and find this file's
// notice (54 → 51 notify, key upkeep:<pane>).
const box = () => {
  window.TnaiNextActions?.openBell(true);
  return document.querySelector('.tnai-bell-pop [data-item^="notice:upkeep:"]');
};
const report = extra =>
  'Done.\n\nTechnically Not report\n- Did: tidied the settings page\n' + (extra || '');
let shell;
try {
  check(
    !!U &&
      U.prefs().on === true &&
      U.prefs().auto === '' &&
      U.prefs().compact === 400000 &&
      U.prefs().clear === 600000 &&
      U.prefs().never === true,
    'TnaiContextUpkeep present; default on (asks), compact 400k, clear 600k, never clear'
  );
  U.set({ on: false, idle: 0, skip: [] });
  shell = await window.TnaiTest.open('Terminal');
  check(shell?.ok, 'PowerShell test pane opened');
  const pane = shell.paneId,
    buf = async () => (await N.pty.replay(pane))?.buffer || '';
  const feed = async (result, tokens, opts) => {
    await main('finish', pane, 'Lyra', result, tokens, opts);
    await wait(700);
  };

  // Defaults scale to the pane's context window until the user sets a threshold; a set threshold is
  // used as is.
  await feed(report(), 100000, { window: 200000 });
  const l1 = U.limits(pane);
  await feed(report(), 100000, { window: 1000000 });
  const l2 = U.limits(pane);
  await feed(report(), 250000);
  const l3 = U.limits(pane);
  check(
    l1.compact === 150000 &&
      l1.clear === 180000 &&
      l2.compact === 400000 &&
      l2.clear === 600000 &&
      l3.window === 1000000 &&
      l3.compact === 400000,
    'default thresholds scale: 200k window → 150k/180k, 1M → 400k/600k, > 200k seen → 1M (' +
      JSON.stringify([l1, l2, l3]) +
      ')'
  );
  U.set({ compact: 120000, clear: 160000, never: false });
  await feed(report(), 100000, { window: 1000000 });
  const l4 = U.limits(pane);
  check(
    l4.compact === 120000 && l4.clear === 160000,
    'user-set thresholds are used as is (' + JSON.stringify(l4) + ')'
  );

  // Off: nothing, even when every condition holds.
  await feed(report(), 134000);
  check(!U.pending().length && !box(), 'setting off: no action at 134k tokens');

  // Turning it on acts on that same finished turn: 134k ≥ compact, < clear → /compact, with a
  // visible question.
  U.set({ on: true });
  const p1 = await until(() => U.pending()[0], 3000);
  check(
    p1?.kind === 'compact' && p1.cmd === '/compact' && p1.tokens === 134000,
    'on: 134k tokens → /compact planned (' + JSON.stringify(p1) + ')'
  );
  check(
    !!box() &&
      /134k tokens in context/.test(box().textContent) &&
      /Run \/compact/.test(box().textContent) &&
      /Not now/.test(box().textContent) &&
      !!box().querySelector('[data-a="retire"]') &&
      /Project Context up to date \(result [0-9a-f]+\)/.test(box().textContent),
    'notice asks: tokens, Run /compact, Retire & hand off, Not now and the result id'
  );
  window.TnaiNextActions.openBell(false);
  document.querySelector('header.top .tnai-bell').click();
  await wait(400);
  console.log('TNAI_SHOT:upkeep-bell');
  await wait(500);
  console.log('TNAI_SHOT:context-upkeep-notice');
  await wait(450);
  box().querySelector('[data-act="remove"]').click();
  await wait(100);
  check(!U.pending().length && !box(), 'Not now stops it');
  await wait(3500);
  check(!/\/compact/.test(await buf()), 'cancelled: nothing typed into the pane');

  // Gate: each of these must do nothing.
  await feed(report(), null);
  check(
    !U.pending().length && U.why(pane) === 'context size unknown',
    'unknown context size: no action (' + U.why(pane) + ')'
  );
  await feed(report(), 170000, { entry: false });
  check(
    !U.pending().length && /no entry/.test(U.why(pane)),
    'stale Project Context (no entry after the last turn): no action (' + U.why(pane) + ')'
  );
  await feed(report(), 170000, { queued: ['also fix the footer'] });
  check(
    !U.pending().length && /queued/.test(U.why(pane)),
    'prompts queued: no action (' + U.why(pane) + ')'
  );
  await feed(report('- Blockers: the build fails on Windows paths\n'), 170000);
  check(
    !U.pending().length && /blockers/.test(U.why(pane)),
    'open blockers: no action (' + U.why(pane) + ')'
  );
  await feed(
    report('- Decide: Which router? | 1. Hash router | 2. History router (recommended)\n'),
    170000
  );
  check(
    !U.pending().length && /decision/.test(U.why(pane)),
    'open decision: no action (' + U.why(pane) + ')'
  );
  await feed(report(), 90000);
  check(!U.pending().length && U.why(pane) === '', 'below both thresholds: no action');
  await feed(report(), 90000, { calls: 200 });
  check(
    !U.pending().length && U.why(pane) === '',
    'many model calls but under 100k context: no action'
  );
  await feed(report(), 110000, { calls: 149 });
  check(
    !U.pending().length && U.why(pane) === '',
    '149 model calls, below the threshold: no action'
  );
  await feed(report(), 110000, { calls: 150 });
  const pLong = await until(() => U.pending()[0], 3000);
  check(
    pLong?.kind === 'compact' && pLong.tokens === 110000,
    '150 model calls at 110k (below the 120k threshold) → /compact planned (' +
      JSON.stringify(pLong) +
      ')'
  );
  await main('compacted', pane, 14000);
  await wait(700);
  check(
    !U.pending().length && !box() && U.why(pane) === '',
    'a finished /compact on the same turn (14k after it) closes the notice and does not ask again (' +
      U.why(pane) +
      ')'
  );
  U.set({ idle: 5 });
  await feed(report(), 170000);
  check(
    !U.pending().length && U.why(pane) === 'idle',
    'not idle long enough (5 min): no action yet'
  );
  U.set({ idle: 0 });

  // Thresholds: ≥ clear with no open next step → /clear; ≥ clear with an open next step → /compact;
  // "never clear" → /compact.
  const p2 = await until(() => U.pending()[0], 3000); // the idle 0 change re-checks that last turn
  check(p2?.kind === 'clear' && p2.cmd === '/clear', '170k tokens, no next steps → /clear planned');
  U.cancel(pane);
  await feed(report('- Next: add a keyboard shortcut\n'), 170000);
  const p3 = await until(() => U.pending()[0], 3000);
  check(
    p3?.kind === 'compact',
    '170k tokens with an open next step → /compact (Project Context keeps the step, the conversation stays)'
  );
  U.cancel(pane);
  U.set({ never: true });
  await feed(report(), 170000);
  const p4 = await until(() => U.pending()[0], 3000);
  check(p4?.kind === 'compact', '"Never clear" → /compact');

  // It waits for the user: nothing runs by itself; Run types /compact into the PowerShell pane and
  // records it on the pane's latest task.
  await wait(4000);
  check(
    U.pending().length === 1 && !/\/compact/.test(await buf()),
    'still asking after 4 s, nothing typed by itself'
  );
  box().querySelector('[data-a="now"]').click();
  check(!U.pending().length, 'Run answers it');
  check(
    !!(await until(async () => /\/compact/.test(await buf()), 5000)),
    '/compact typed into the pane'
  );
  check(
    /^Compacted .+ at 170k tokens \(Project Context up to date: result [0-9a-f]+\)/.test(
      window.TnaiLiveTasks?.get(pane)?.text || ''
    ),
    'recorded: ' + (window.TnaiLiveTasks?.get(pane)?.text || '')
  );
  U.set({ never: false });
  await wait(1000);
  check(
    !U.pending().length,
    'at most once per finished turn (a settings change re-checks it, nothing new is planned)'
  );

  // Hand-off (2026-09-28): below the compact size, a session at the hand-off size (or age) is
  // offered "Retire & hand off" first; Not now snoozes it.
  check(
    U.prefs().age === 2 && U.prefs().handoff === 150000,
    'hand-off defaults: 2 hours or 150k tokens'
  );
  U.set({ compact: 400000, clear: 600000, never: true, handoff: 150000, age: 0 });
  await feed(report(), 160000);
  const ph = await until(() => U.pending()[0], 3000);
  check(
    ph?.handoff === true && ph.tokens === 160000,
    '160k (below the 400k compact size) at the 150k hand-off size → hand-off offered (' +
      JSON.stringify(ph) +
      ')'
  );
  check(
    /has run \d+ h \d+ min · 160k tokens/.test(box().textContent) &&
      /Run \/compact/.test(box().textContent) &&
      /Not now/.test(box().textContent),
    'hand-off notice text: ' + box().textContent.slice(0, 140)
  );
  U.cancel(pane);
  await feed(report(), 165000);
  await wait(500);
  check(
    !U.pending().length,
    'Not now on a hand-off: not asked again on the next turn (snoozed an hour)'
  );
  U.set({ handoff: 0 });
  await feed(report(), 170000);
  await wait(500);
  check(
    !U.pending().length && U.why(pane) === '',
    'hand-off size and age off: no offer below the compact size'
  );
  U.set({ compact: 120000, clear: 160000, handoff: 150000, age: 2 });

  // Without asking + Summarize first: the agent is asked for its summary;
  // /compact is typed only when that reply has ended.
  check(U.prefs().brief === true, 'Summarize first is on by default');
  U.set({ handoff: 0, age: 0, auto: 'compact', compact: 120000, never: true, idle: 0 });
  const mark1 = (await buf()).length;
  await feed(report(), 180000);
  await wait(600);
  const b1 = U.briefing()[0],
    out1 = (await buf()).slice(mark1);
  check(
    b1?.paneId === pane && b1.cmd === '/compact' && !b1.replied && !U.pending().length,
    'Without asking at 180k: a summary is asked for first, no bell item (' +
      JSON.stringify(b1) +
      ')'
  );
  const grew1 = await until(async () => (await buf()).length !== mark1, 8000);
  check(
    !!grew1 &&
      U.briefing()[0]?.replied === false &&
      !/after it wrote its summary/.test(window.TnaiLiveTasks?.get(pane)?.text || ''),
    'the summary prompt was sent to the panel; /compact waits for the reply'
  );
  const mark2 = (await buf()).length;
  await feed(report('- Remains: nothing\n'), 182000, { fresh: true });
  await wait(1200);
  check(
    !U.briefing().length &&
      /^Compacted .+ at 180k tokens after it wrote its summary \(saved in Project Context\)/.test(
        window.TnaiLiveTasks?.get(pane)?.text || ''
      ),
    'when the summary reply ended and was saved, /compact ran: ' +
      (window.TnaiLiveTasks?.get(pane)?.text || '')
  );
  check(
    !U.pending().length && !U.briefing().length,
    'the summary reply itself is not offered again'
  );
  await feed(report(), 185000);
  await wait(600);
  check(U.briefing().length === 1, 'the next large turn asks for a summary again');
  shell &&
    document
      .querySelector('.terminal-pane[data-pane-id="' + pane + '"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  await wait(200);
  check(!U.briefing().length, 'typing in the panel cancels the automatic compact');
  U.set({ brief: false });
  const mark3 = (await buf()).length;
  await feed(report(), 190000);
  await wait(900);
  check(
    !U.briefing().length &&
      /^Compacted .+ at 190k tokens \(Project Context up to date/.test(
        window.TnaiLiveTasks?.get(pane)?.text || ''
      ),
    'Summarize first off: /compact runs at once, as before: ' +
      (window.TnaiLiveTasks?.get(pane)?.text || '')
  );
  U.set({ auto: '', brief: true, handoff: 150000, age: 2, clear: 160000, never: false });
  await feed(report(), 100000);
  await wait(300);

  window.TnaiSettings.open('agents');
  await wait(200);
  const set = document.querySelector('#settingsPanel-agents .tnai-upkeep-set');
  check(
    !!set?.querySelector('[data-k=brief]') &&
      set.querySelector('[data-k=brief]').checked &&
      set.querySelector('[data-k=brief]').disabled,
    'Settings: Summarize first switch is there, on, and grayed while Without asking is not Compact'
  );
  check(
    !!set &&
      set.querySelector('[data-k=on]').checked &&
      set.querySelector('[data-k=compact]').value === '120000' &&
      set.querySelectorAll('[data-cli]').length === 3 &&
      !!set.querySelector('[data-k=idle]') &&
      !!set.querySelector('[data-k=never]') &&
      set.querySelector('[data-k=auto]:checked')?.value === '',
    'Settings › Agents: switch, thresholds, never clear, idle minutes, per-CLI (' +
      (set
        ? [
            set.querySelector('[data-k=on]')?.checked,
            set.querySelector('[data-k=compact]')?.value,
            set.querySelectorAll('[data-cli]').length,
          ]
        : 'no section') +
      ')'
  );
  window.TnaiNextActions?.pending().forEach(window.TnaiNextActions.dismiss);
  await wait(100);
  set?.scrollIntoView({ block: 'center' });
  console.log('TNAI_SHOT:context-upkeep-settings');
  await wait(450);
  U.set({ on: false, compact: 400000, clear: 600000, never: true });
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
if (shell?.paneId) G.stop(shell.paneId);

// Migration of old saved settings (continued in .after.js / .after2.js): seed what an older
// Technically Not stored (v1: every key, old defaults 120k/160k/never off) with a compact
// threshold, idle minutes and a skipped CLI the user set by hand; the reload must move the rest to
// the new defaults.
if (ok) {
  localStorage.removeItem('tnai.context-upkeep.v2');
  localStorage.setItem(
    'tnai.context-upkeep.v1',
    JSON.stringify({
      on: true,
      compact: 250000,
      clear: 160000,
      never: false,
      idle: 5,
      skip: ['Codex'],
      auto: '',
    })
  );
  log.push(
    'seeded old v1 settings (compact 250k, idle 5, skip Codex set by hand; clear/never at old defaults)'
  );
}
return { ok, log, reload: ok };
