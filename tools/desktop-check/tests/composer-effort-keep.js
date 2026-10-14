/*
 * Technically Not tools · desktop-check/tests/composer-effort-keep.js — The Effort pick under the
 * composer keeps showing what the user chose (picked Opus 5.5 + High, sent,
 * and the pick no longer showed High). Against a FAKE `claude` (composer-effort-keep.main.js; no
 * real CLI, no usage): a new agent picked with Opus 5.5 + High starts with `--effort high`; the
 * pick still shows High after the send, after a task whose reply names no effort, after a task with
 * a sub-agent that ran at another effort, and after a reply written before the pick; an effort the
 * agent's own reply reports later (a /effort typed in its terminal) still replaces it, as before.
 * Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
  return !!cond;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
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
const G = window.TnaiAgents,
  L = window.TnaiLiveTasks,
  N = window.tnaiNative,
  P = window.TnaiLaunchPrefs,
  CLAUDE = 'Claude Code';
const savedPrefs = localStorage.getItem('tnai.launch-prefs.v1');
let paneId;
try {
  await G.detect?.();
  await window.TnaiAccounts?.refresh?.();
  window.TnaiRoute?.('overview');
  await wait(300);
  const [agentSel, modelSel, effortSel] = document.querySelectorAll(
    '.composer .tnai-pickers select'
  );

  // what the user reads on the Effort pill
  const pill = () => effortSel.nextElementSibling.querySelector('span').textContent;
  const screen = async id =>
    ((await N.pty.replay(id))?.buffer || '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ' ')
      .replace(/\s+/g, ' ');

  // The user's steps: a new Claude Code agent, Opus 5.5, High, then a prompt sent from the
  // composer.
  const fresh = [...agentSel.options].find(o => o.value.startsWith('new:Claude Code|'));
  if (!check(!!fresh, 'a new Claude Code agent can be picked'))
    throw new Error(
      'no new Claude Code row: ' + [...agentSel.options].map(o => o.textContent).join(', ')
    );
  agentSel.value = fresh.value;
  agentSel.dispatchEvent(new Event('change'));
  await until(
    () => !modelSel.disabled && modelSel.querySelector('option[value="claude-opus-5-5"]')
  );
  modelSel.value = 'claude-opus-5-5';
  modelSel.dispatchEvent(new Event('change'));
  effortSel.value = 'high';
  effortSel.dispatchEvent(new Event('change'));
  await wait(100);
  check(pill() === 'High', 'before the send the Effort pill shows High: ' + JSON.stringify(pill()));

  // The panel is opened the way the composer's send opens it (10 start → TnaiLaunchPrefs.start).
  // The composer's own send is not used: it waits for Claude Code to connect to Technically Not,
  // which the fake never does.
  const p = document.getElementById('prompt');
  const opened = await window.TnaiTest.open(CLAUDE, { accountId: '' });
  if (!check(!!opened?.ok, 'a new Claude Code panel opened')) throw new Error('no new panel');
  paneId = opened.paneId;
  const started = await until(
    async () => (/FAKE-claude model=\S+ effort=\S+ \./.exec(await screen(paneId)) || [])[0],
    20000
  );
  check(
    /model=claude-opus-5-5 effort=high /.test(started || ''),
    'the CLI was started on the pick: ' + JSON.stringify(started)
  );
  check(
    P.pane(paneId, CLAUDE).effort === 'high',
    'the panel remembers the effort it started on: ' + JSON.stringify(P.pane(paneId, CLAUDE))
  );

  // The pill for that agent (the composer's target is the running agent once it got the prompt).
  L.newAgent(false);
  L.setTarget(paneId);
  await wait(200);
  check(
    pill() === 'Effort: High',
    'after the send, with that agent as the target, the pill shows High: ' + JSON.stringify(pill())
  );

  // A task whose reply names no effort.
  let t = await main('turn', paneId, {});
  await wait(300);
  check(
    t.ended && t.effort === '' && pill() === 'Effort: High',
    'after a reply that names no effort: ' + JSON.stringify(pill())
  );

  // A task in which a sub-agent ran at another effort (its own transcript says medium; the lead's
  // reply says high).
  t = await main('turn', paneId, { effort: 'high', sub: 'medium' });
  await wait(300);
  check(
    t.effort === 'high' && pill() === 'Effort: High',
    'after a task with a sub-agent at medium: ' +
      JSON.stringify(pill()) +
      ' (turn ' +
      t.effort +
      ')'
  );

  // A reply written before the panel started on High (an older line read late) must not replace the
  // pick.
  t = await main('turn', paneId, { effort: 'low', at: Date.now() - 3600e3 });
  await wait(300);
  check(
    pill() === 'Effort: High',
    'after a reply older than the pick (low, an hour old): ' + JSON.stringify(pill())
  );
  check(
    P.pane(paneId, CLAUDE).effort === 'high',
    'the pick kept for the panel is still high: ' + JSON.stringify(P.pane(paneId, CLAUDE))
  );

  // Unchanged behavior: the effort the agent's own later reply reports (a /effort typed in its
  // terminal) shows on the pill.
  t = await main('turn', paneId, { effort: 'max' });
  await wait(300);
  check(
    pill() === 'Effort: Max',
    'a later reply at another effort (a /effort typed in the terminal) still updates the pill: ' +
      JSON.stringify(pill())
  );

  // …and the pick for new agents is not touched by any of it.
  L.setTarget(null);
  L.newAgent(CLAUDE);
  await wait(200);
  check(
    pill() === 'High' && P.for(CLAUDE).effort === 'high',
    'the pick for new agents still shows High: ' + JSON.stringify(pill())
  );
  L.newAgent(false);
  p.value = '';
  p.dispatchEvent(new Event('input', { bubbles: true }));
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
if (paneId) {
  G.stop(paneId);
  await wait(400);
}
if (savedPrefs === null) localStorage.removeItem('tnai.launch-prefs.v1');
else localStorage.setItem('tnai.launch-prefs.v1', savedPrefs);
return { ok, log };
