/*
 * Technically Not tools · desktop-check/tests/context-budget.js — Composer context budget (11): an
 * agent whose latest turn reports a context size at or over 80% of its own model window (the
 * stand-in's reported window here; the fixed 300k budget only when the window is unknown or the
 * user set one) gets its next Auto-routed composer task in a NEW pane of the same CLI and account,
 * with a short handoff note; under the budget it keeps it; a full workspace or a user-picked agent
 * keeps it with a warning. Context sizes are pushed on the real agent:turn channel
 * (live-activity.main.js). No paid agent: PowerShell panes stand in for a Claude Code session, the
 * CLI Auto routes to (session list stubbed) and TnaiTeam.startLead is stubbed to open a PowerShell
 * pane.
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
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 5000);
  });
const G = window.TnaiAgents;

// Auto only hands tasks to running agents of the default CLI (11 route), Claude Code unless the
// user picked another
const CLI = 'Claude Code';
try {
  await new Promise(r => setTimeout(r, 300));
  {
    const T = window.TnaiLiveTasks,
      team = window.TnaiTeam,
      realSessions = G.sessions,
      realStart = team.startLead,
      realFull = window.TnaiPaneLimit.full;
    const fake = new Set(),
      starts = [];
    try {
      check(
        T.contextBudget() === 300000,
        'context budget default 300k (' + T.contextBudget() + ')'
      );
      const old = await window.TnaiTest.open('Terminal');
      check(old?.ok, 'stand-in agent pane opened');
      fake.add(old.paneId);
      await until(() => realSessions().find(x => x.paneId === old.paneId && x.running), 15000);
      G.sessions = () =>
        realSessions()
          .filter(x => fake.has(x.paneId))
          .map(x => ({ ...x, agent: CLI, status: 'waiting', accountId: 'acct-test' }));
      team.startLead = async opts => {
        starts.push(opts);
        const o = await window.TnaiTest.open('Terminal');
        if (!o?.ok) return { error: o?.error || 'no pane' };
        fake.add(o.paneId);
        await until(() => realSessions().find(x => x.paneId === o.paneId && x.running), 15000);
        return G.sessions().find(x => x.paneId === o.paneId);
      };
      T.setTarget?.('');
      await wait(50);
      const oldName = G.sessions().find(x => x.paneId === old.paneId).name;
      const ctx = async (tokens, win = 272000) => {
        await main('turn', {
          paneId: old.paneId,
          agent: CLI,
          source: 'test',
          startedAt: Date.now() - 5000,
          endedAt: Date.now(),
          endedBy: 'stop',
          tokens: null,
          context: { tokens, window: win, at: Date.now() },
          queued: [],
        });
        await until(() => window.TnaiTurns.get(old.paneId)?.context?.tokens === tokens, 3000);
      };
      await ctx(120000);
      const chip = () =>
        document.querySelector(
          '.terminal-pane[data-pane-id="' + old.paneId + '"]>.terminal-pane-head>.tnai-ctx'
        );
      check(
        !!(await until(() => chip()?.hidden, 3000)),
        'context warning (76): no chip at 44% of the window'
      );
      let r = T.route(false);
      check(
        r.kind === 'direct' && r.paneId === old.paneId && !r.over,
        'under budget (120k): the task stays with ' +
          oldName +
          ' (' +
          r.kind +
          ' · ' +
          r.label +
          ')'
      );
      await ctx(210000);
      check(
        !!(await until(
          () =>
            chip() &&
            !chip().hidden &&
            chip().dataset.level === 'warn' &&
            /210k · 77%/.test(chip().textContent),
          3000
        )),
        'context warning: amber chip at 77% ("' + chip()?.textContent + '")'
      );
      r = T.route(false);
      check(
        r.kind === 'direct' && !r.over,
        '210k of a 272k window (77%, under 80%): stays (' + r.label + ')'
      );
      await ctx(231000);
      check(
        !!(await until(
          () =>
            chip()?.dataset.level === 'high' &&
            /85%/.test(chip().textContent) &&
            /re-sends this context/.test(chip().title),
          3000
        )),
        'context warning: red chip at 85% with the why in its tooltip'
      );
      check(
        !!(await until(
          () =>
            /context is large \(231k, 85% full\)/.test(
              document.getElementById('toast')?.textContent || ''
            ),
          3000
        )),
        'context warning: one toast on crossing 80% ("' +
          document.getElementById('toast')?.textContent +
          '")'
      );
      {
        const setIn = (k, v) => {
          const inp = document.querySelector('.tnai-ctx-set [data-cw=' + k + ']');
          if (k === 'on') inp.checked = v;
          else inp.value = v;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        };
        check(
          !!document.querySelector('.tnai-upkeep-set .tnai-ctx-set [data-cw=high]'),
          'context warning settings sit in Settings › Agents › Agent context'
        );
        setIn('high', 90);
        check(
          !!(await until(() => chip()?.dataset.level === 'warn', 3000)),
          'Red at 90%: the 85% chip turns amber'
        );
        setIn('on', false);
        check(!!(await until(() => chip()?.hidden, 3000)), 'warnings off: chip hidden');
        window.TnaiContextWarning.set({ on: true, high: 80 });
        await wait(100);
        window.TnaiContextWarning.paint();
        check(
          !!(await until(() => chip()?.dataset.level === 'high', 3000)),
          'back to defaults: red again'
        );

        // The number on a row of the old Agents page went with that page (2026-10-13).
        T.setTarget?.('');
        await wait(50); // the Agents page made its selected agent the composer target
      }
      r = T.route(false);
      check(
        r.kind === 'handoff' &&
          r.start === CLI &&
          r.full?.tokens === 231000 &&
          r.full?.pct === 85 &&
          r.label.includes(oldName + ' is near its context limit (85% of 272k)'),
        'near full (231k of 272k = 85%): routes to a new ' +
          CLI +
          ' (' +
          r.kind +
          ' · ' +
          r.label +
          ')'
      );
      const hint = document.querySelector('.tnai-route-hint');
      check(
        !!(await until(
          () => /near its context limit \(85% of 272k\)/.test(hint?.textContent || ''),
          3000
        )),
        'composer hint says so: "' + hint?.textContent + '"'
      );
      window.TnaiPaneLimit.full = () => true;
      r = T.route(false);
      window.TnaiPaneLimit.full = realFull;
      check(
        r.kind === 'direct' &&
          r.paneId === old.paneId &&
          /workspace is full, so it keeps this/.test(r.over),
        'workspace full: keeps it and says so (' + r.label + ')'
      );
      T.setTarget(old.paneId);
      await wait(50);
      r = T.route(false);
      check(
        r.kind === 'direct' &&
          r.paneId === old.paneId &&
          /near its context limit \(85%/.test(r.label),
        'user-picked agent is honored with the warning (' + r.label + ')'
      );
      T.setTarget('');
      await wait(50);

      // Real send: Enter in the composer → a new pane gets the handoff + task; the old pane gets
      // nothing.
      const prompt = document.getElementById('prompt'),
        toastEl = document.getElementById('toast');
      prompt.value = 'echo budgettask42';
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      prompt.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
      const fresh = await until(() => [...fake].find(id => id !== old.paneId), 20000);
      check(
        starts.length === 1 && starts[0].agent === CLI && starts[0].accountId === 'acct-test',
        'fresh agent started with the same CLI and account (' + JSON.stringify(starts[0]) + ')'
      );
      const buf = async id => (await window.tnaiNative.pty.replay(id))?.buffer || '';
      check(
        !!fresh && !!(await until(async () => /budgettask42/.test(await buf(fresh)), 8000)),
        'the task reached the new pane'
      );
      const got = (await buf(fresh))
        .replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '')
        .replace(/[\r\n]+/g, '');
      const at = got.indexOf('TN.ai handoff: ');
      check(
        at >= 0 &&
          got.includes(oldName) &&
          /231k tokens of context \(85% of its 272k window\)/.test(got),
        'with the handoff note (old agent, tokens, limit): ' +
          JSON.stringify(got.slice(Math.max(0, at), Math.max(0, at) + 260))
      );
      check(!/budgettask42/.test(await buf(old.paneId)), 'the over-budget pane got nothing');
      check(
        !!(await until(
          () =>
            /is near its context limit \(85% of 272k\) — sent to a new agent: /.test(
              toastEl.textContent
            ),
          3000
        )),
        'toast: "' + toastEl.textContent + '"'
      );
      const row = window.TnaiLiveFeed?.items?.().find(
        x =>
          x.paneId === old.paneId &&
          /near its context limit \(85%\) — sent to a new agent: /.test(x.text)
      );
      check(
        !!row,
        'the reroute is logged as an event: ' + JSON.stringify(row?.line || row?.text || '')
      );
    } finally {
      G.sessions = realSessions;
      team.startLead = realStart;
      window.TnaiPaneLimit.full = realFull;
      T.setTarget?.('');
      fake.forEach(id => G.stop(id));
    }
  }
} catch (error) {
  check(false, 'threw: ' + (error?.stack || error));
}
return { ok, log };
