/*
 * Technically Not tools · desktop-check/tests/plan-limits.js — Plan limits per account
 * (80-plan-limits.js + desktop/plan-limits.js) against the fixtures in plan-limits.main.js: the
 * default Claude Code account's bars in Settings › Accounts (47% session, 91% week = high) from the
 * local usage server with the sign-in token, the default Codex account's weekly bar from its
 * session file, 98's gauges in Settings › Accounts (the top bar chip was removed in the purple
 * redesign), and a stale reading dimmed. Light + Dark screenshots. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
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

try {
  check(
    !!window.TnaiPlanLimits && !!window.tnaiNative?.usage?.limits,
    'TnaiPlanLimits and the usage.limits bridge are present'
  );
  await window.TnaiPlanLimits.refresh();
  const claude = window.TnaiPlanLimits.get('Claude Code', '');
  check(
    claude?.status === 'ok' && claude.windows.map(w => w.used).join() === '47,91',
    'Claude Code default account: 47% session, 91% week (' + JSON.stringify(claude) + ')'
  );
  const served = await main('asks');
  check(
    served.asks >= 1 && served.auth === 'Bearer test-token',
    'usage request sent with the account’s own sign-in token (' + served.asks + ' asks)'
  );

  // The top bar / composer session chip was removed in the purple redesign (2026-09-30): readings
  // show as 98's gauges in Settings › Accounts (and on the Overview's AI accounts card).
  window.TnaiSettings.open('accounts');
  await wait(300);
  const mount = document.getElementById('tnaiAccountsMount');
  const gauge = await until(() => {
    const g = [...(mount?.querySelectorAll('.tnai-acct-gauge[data-g-acct=""]') || [])].find(x =>
      /claude/i.test(x.dataset.gAgent)
    );
    return g?.querySelectorAll('.ag-w').length === 2 && /47%/.test(g.textContent) && g;
  });
  const ws = gauge ? [...gauge.querySelectorAll('.ag-w')] : [];
  check(
    ws.length === 2 &&
      /Session/.test(ws[0].textContent) &&
      /47%/.test(ws[0].textContent) &&
      /resets in/.test(ws[0].textContent),
    'Claude Code account gauge: Session 47% with its reset (' + (ws[0]?.textContent || 'none') + ')'
  );
  check(
    ws[1]?.dataset.lv === 'hot' && /91%/.test(ws[1].textContent),
    'Claude Code week at 91% is marked hot'
  );
  const codexGauge = () =>
    [...(mount?.querySelectorAll('.tnai-acct-gauge[data-g-acct=""]') || [])].find(x =>
      /codex/i.test(x.dataset.gAgent)
    );
  if (codexGauge()) {
    const cg = await until(() => /84%/.test(codexGauge()?.textContent || '') && codexGauge(), 3000);
    check(
      !!cg,
      'Codex default account gauge: weekly 84% from its session file (' +
        (codexGauge()?.textContent || '') +
        ')'
    );
  } else log.push('skip Codex gauge: Codex not installed on this PC');

  // Top bar chip beside CPU / RAM / GPU: the plan usage of the agent last
  // clicked into; it switches with the agent and goes away for one with no plan reading. The
  // sessions are stand-ins (no real CLI runs here); the readings are the ones above.
  {
    const realSessions = window.TnaiAgents.sessions,
      fake = [
        { paneId: 'chip-claude', agent: 'Claude Code', accountId: '', name: 'Ada' },
        { paneId: 'chip-codex', agent: 'Codex', accountId: '', name: 'Cody' },
        { paneId: 'chip-shell', agent: 'Terminal', accountId: '', name: 'Shell' },
      ];
    window.TnaiAgents.sessions = () => [...realSessions(), ...fake];
    const pick = async id => {
      window.dispatchEvent(new CustomEvent('tnai:target-changed', { detail: { paneId: id } }));
      await wait(100);
      return document.querySelector('.top-right>.tnai-sys-chip .pg-chip[data-m="plan"]');
    };
    if (
      await until(
        () => document.querySelector('.top-right>.tnai-sys-chip:not(.off) .pg-chip[data-m="cpu"]'),
        6000
      )
    ) {
      let c = await pick('chip-claude');
      check(
        !!c &&
          c.previousElementSibling?.dataset.m &&
          /Claude/.test(c.querySelector('.k').textContent) &&
          /47%\s*5h\s*91%\s*wk/.test(c.textContent) &&
          /Ada/.test(c.title),
        'top bar chip after the telemetry chips shows the clicked Claude Code agent: ' +
          (c?.textContent || 'none')
      );
      await (window.TnaiTest?.shot?.('plan-limits-chip') ?? wait(500));
      c = await pick('chip-codex');
      if (window.TnaiPlanLimits.get('Codex', '')?.windows?.length)
        check(
          !!c &&
            /Codex/.test(c.querySelector('.k').textContent) &&
            /84%/.test(c.textContent) &&
            !/47%/.test(c.textContent),
          'clicking a Codex agent switches the chip to its account: ' + (c?.textContent || 'none')
        );
      else check(!c, 'a Codex agent with no reading: no chip (Codex not installed on this PC)');
      check(!(await pick('chip-shell')), 'a PowerShell panel has no plan usage: the chip is gone');
      check(!!(await pick('chip-claude')), 'back on the Claude Code agent: the chip is back');
      window.dispatchEvent(
        new CustomEvent('tnai:terminal-pane-closed', { detail: { paneId: 'chip-claude' } })
      );
      await wait(100);
    } else
      log.push(
        'skip top bar chip: no CPU / RAM / GPU chips in this window (too narrow or no stats)'
      );
    window.TnaiAgents.sessions = realSessions;
  }

  // A failing usage server keeps the last good reading, marked stale, and the gauge dims.
  await main('fail', true);
  await wait(10500);
  await window.TnaiPlanLimits.refresh(); // main reuses a Claude reading for 10 s even when forced
  const stale = window.TnaiPlanLimits.get('Claude Code', '');
  check(
    stale?.status === 'ok' && stale.stale && stale.windows?.[0]?.used === 47,
    'usage server fails: the last good Claude Code reading stays, marked stale (' +
      JSON.stringify({ status: stale?.status, stale: stale?.stale, detail: stale?.detail }) +
      ')'
  );
  check(
    !!(await until(
      () =>
        gauge?.querySelector('.ag-acct.stale') ||
        mount.querySelector('.tnai-acct-gauge .ag-acct.stale'),
      3000
    )),
    'the gauge shows it dimmed (stale)'
  );
  await main('fail', false);
  await wait(10500);
  await window.TnaiPlanLimits.refresh();
  check(
    !window.TnaiPlanLimits.get('Claude Code', '')?.stale,
    'Claude Code reading back: not stale'
  );
  window.TnaiTheme?.set('light');
  await wait(400);

  // capture is async: give it time before the theme switch
  await (window.TnaiTest?.shot?.('plan-limits-light') ?? wait(1500));
  window.TnaiTheme?.set('dark');
  await wait(400);
  await (window.TnaiTest?.shot?.('plan-limits-dark') ?? wait(450));
  window.TnaiTheme?.set('light');
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
return { ok, log };
