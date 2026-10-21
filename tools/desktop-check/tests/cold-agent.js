/*
 * Technically Not tools · desktop-check/tests/cold-agent.js — Cold agent offer (11 send + 77
 * askCold): a composer prompt to an agent idle longer than its prompt cache lives
 * (context.cacheTtlMs, else an hour) with at least 150k tokens of context (under its budget) asks
 * once per idle spell: Send anyway (sent as before, not asked again), Compact first (/compact
 * typed, then the prompt), New agent (a fresh pane of the same CLI and account gets the task with a
 * handoff), Cancel (draft kept). A recent turn or a small context is never asked. Context sizes are
 * pushed on the real agent:turn channel (live-activity.main.js). No paid agent: PowerShell panes
 * stand in for a Claude Code session (session list stubbed) and TnaiTeam.startLead opens a
 * PowerShell pane.
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
const G = window.TnaiAgents,
  CLI = 'Claude Code';
try {
  await wait(300);
  const T = window.TnaiLiveTasks,
    team = window.TnaiTeam,
    realSessions = G.sessions,
    realStart = team.startLead;
  const fake = new Set(),
    starts = [];
  try {
    const old = await window.TnaiTest.open('Terminal');
    check(old?.ok, 'stand-in agent pane opened');
    fake.add(old.paneId);
    await until(() => realSessions().find(x => x.paneId === old.paneId && x.running), 15000);

    // hidden: a pane id the stand-in list leaves out, as if that agent went away
    let hidden = '';
    G.sessions = () =>
      realSessions()
        .filter(x => fake.has(x.paneId) && x.paneId !== hidden)
        .map(x => ({ ...x, agent: CLI, status: 'waiting', accountId: 'acct-test' }));
    team.startLead = async opts => {
      starts.push(opts);
      const o = await window.TnaiTest.open('Terminal');
      if (!o?.ok) return { error: o?.error || 'no pane' };
      fake.add(o.paneId);
      await until(() => realSessions().find(x => x.paneId === o.paneId && x.running), 15000);
      return G.sessions().find(x => x.paneId === o.paneId);
    };
    T.setTarget?.(old.paneId);
    await wait(50);
    const oldName = G.sessions().find(x => x.paneId === old.paneId).name;
    const turn = async (tokens, idleMin, cacheTtlMs) => {
      const end = Date.now() - idleMin * 60000;
      await main('turn', {
        paneId: old.paneId,
        agent: CLI,
        source: 'test',
        startedAt: end - 5000,
        endedAt: end,
        endedBy: 'stop',
        tokens: null,
        context: { tokens, window: 1000000, at: end, ...(cacheTtlMs ? { cacheTtlMs } : {}) },
        queued: [],
      });
      await until(() => window.TnaiTurns.get(old.paneId)?.endedAt === end, 3000);
    };
    const prompt = document.getElementById('prompt'),
      dialog = () =>
        [...document.querySelectorAll('.tnai-offtopic-overlay')].find(o =>
          /idle for/.test(o.querySelector('h2')?.textContent || '')
        );
    const shown = () => {
      const d = dialog();
      return d && !d.hidden ? d : null;
    };
    const buf = async id =>
      ((await window.tnaiNative.pty.replay(id))?.buffer || '')
        .replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '')
        .replace(/[\r\n]+/g, '');
    const send = text => {
      prompt.value = text;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      prompt.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    };

    await turn(160000, 5);
    send('echo warmtask1');
    check(
      !!(await until(async () => /warmtask1/.test(await buf(old.paneId)), 8000)) && !shown(),
      'recent turn (5 min idle): sent, not asked'
    );
    await turn(90000, 70);
    send('echo smalltask2');
    check(
      !!(await until(async () => /smalltask2/.test(await buf(old.paneId)), 8000)) && !shown(),
      'small context (90k): sent, not asked'
    );

    // The cache lifetime the transcript reported wins over the one-hour default: 5 minutes (API
    // key, usage credits) asks after 6, an hour does not after 50.
    await turn(160000, 50, 3600000);
    send('echo hourtask2b');
    check(
      !!(await until(async () => /hourtask2b/.test(await buf(old.paneId)), 8000)) && !shown(),
      'one-hour cache, 50 min idle: sent, not asked'
    );
    await turn(160000, 6, 300000);
    send('echo fivetask2c');
    const d5 = await until(shown, 3000);
    check(
      !!d5 &&
        d5.querySelector('h2').textContent === oldName + ' has been idle for 6 minutes' &&
        /after 5 minutes idle/.test(d5.querySelector('p').textContent),
      '5-minute cache, 6 min idle: asked — "' +
        d5?.querySelector('p')?.textContent.slice(0, 90) +
        '"'
    );
    d5?.querySelector('[data-pick="send"]').click();
    check(
      !!(await until(async () => /fivetask2c/.test(await buf(old.paneId)), 8000)),
      '5-minute cache: Send anyway sends'
    );

    await turn(160000, 70);
    send('echo coldtask3');
    const d = await until(shown, 3000);
    check(
      !!d &&
        d.querySelector('h2').textContent === oldName + ' has been idle for 70 minutes' &&
        /160k tokens/.test(d.querySelector('p').textContent) &&
        /Compact first pays that read once/.test(d.querySelector('p').textContent),
      'cold (160k, 70 min): asked — "' + d?.querySelector('h2')?.textContent + '"'
    );
    check(
      document.activeElement === d?.querySelector('[data-pick="compact"]'),
      'Compact first has focus'
    );
    d?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(
      !!(await until(() => !shown(), 2000)) &&
        prompt.value === 'echo coldtask3' &&
        !/coldtask3/.test(await buf(old.paneId)),
      'Esc: nothing sent, the draft stays'
    );

    send('echo coldtask3');
    (await until(shown, 3000))?.querySelector('[data-pick="send"]').click();
    check(
      !!(await until(async () => /coldtask3/.test(await buf(old.paneId)), 8000)),
      'Send anyway: sent as before'
    );
    send('echo coldtask4');
    check(
      !!(await until(async () => /coldtask4/.test(await buf(old.paneId)), 8000)) && !shown(),
      'same idle spell: not asked again'
    );

    // The agents change while the dialog is open (audit app-4 #4): the answer was for a route that
    // is gone, so nothing is sent, the draft stays, and the next Enter routes anew.
    await turn(165000, 72);
    send('echo coldtask4b');
    const dStale = await until(shown, 3000);
    hidden = old.paneId;
    dStale?.querySelector('[data-pick="send"]').click();
    await wait(600);
    check(
      !!dStale &&
        prompt.value === 'echo coldtask4b' &&
        !/coldtask4b/.test(await buf(old.paneId)) &&
        starts.length === 0 &&
        /agents changed while you chose/.test(document.body.textContent),
      'agents changed while asked: nothing sent, the draft stays, it says why'
    );
    hidden = '';
    send('echo coldtask4b');
    check(
      !!(await until(async () => /coldtask4b/.test(await buf(old.paneId)), 8000)) && !shown(),
      'the next Enter sends on the current route'
    );

    await turn(170000, 75);
    send('echo coldtask5');
    (await until(shown, 3000))?.querySelector('[data-pick="compact"]').click();
    const got = await until(async () => {
      const b = await buf(old.paneId);
      return /\/compact.*coldtask5/.test(b) ? b : null;
    }, 8000);
    check(!!got, 'Compact first: /compact typed, then the prompt');

    await turn(180000, 80);
    send('echo coldtask6');
    (await until(shown, 3000))?.querySelector('[data-pick="new"]').click();
    const fresh = await until(() => [...fake].find(id => id !== old.paneId), 20000);
    check(
      starts.length === 1 && starts[0].agent === CLI && starts[0].accountId === 'acct-test',
      'New agent: same CLI and account (' + JSON.stringify(starts[0]) + ')'
    );
    const nb =
      fresh &&
      (await until(async () => {
        const b = await buf(fresh);
        return /coldtask6/.test(b) ? b : null;
      }, 8000));
    check(
      !!nb && nb.includes(oldName) && /180k tokens of context \(idle over an hour\)/.test(nb),
      'the task reached the new pane with the handoff: ' +
        JSON.stringify((nb || '').slice(Math.max(0, (nb || '').indexOf('handoff')), 200))
    );
    check(!/coldtask6/.test(await buf(old.paneId)), 'the cold pane got nothing');
  } finally {
    G.sessions = realSessions;
    team.startLead = realStart;
    T.setTarget?.('');
    fake.forEach(id => G.stop(id));
  }
} catch (error) {
  check(false, 'threw: ' + (error?.stack || error));
}
return { ok, log };
