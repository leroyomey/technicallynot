/*
 * Technically Not tools · desktop-check/tests/composer-access.js — The Access pill under the
 * composer, against a FAKE `claude` (composer-access.main.js; no
 * real CLI, no usage): six levels, CLI default first; levels a CLI has no flag for greyed out with
 * the reason; the pick is remembered per project and the Settings default covers projects without
 * one; a new Claude Code panel starts with the picked --permission-mode and with none at CLI
 * default; on a running agent the pill says the change takes effect when it next starts; a
 * sub-agent never gets more access than its lead. The composer's own send is not used (it waits for
 * the CLI to connect, which a fake never does). Returns {ok, log}.
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
const G = window.TnaiAgents,
  L = window.TnaiLiveTasks,
  N = window.tnaiNative,
  P = window.TnaiLaunchPrefs,
  CLAUDE = 'Claude Code';
const KEYS = ['tnai.access.v1', 'tnai.access-default.v1'],
  saved = KEYS.map(k => localStorage.getItem(k));
const panes = [];
try {
  await G.detect?.();
  await window.TnaiAccounts?.refresh?.();
  window.TnaiRoute?.('overview');
  await wait(300);
  const accessSel = document.querySelector('.composer .tnai-pick[data-pick="access"] select');
  if (!check(!!accessSel, 'the Access pill is in the Agent · Model · Effort row'))
    throw new Error('no Access pill');
  const pill = () => accessSel.nextElementSibling.querySelector('span').textContent;
  const opts = () => [...accessSel.options].map(o => o.value + (o.disabled ? ':off' : ''));
  const pick = async v => {
    accessSel.value = v;
    accessSel.dispatchEvent(new Event('change'));
    await wait(150);
  };
  const screen = async id =>
    ((await N.pty.replay(id))?.buffer || '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ' ')
      .replace(/\s+/g, ' ');
  const root = (await N.fs.root()) || '';

  // Levels for a new Claude Code agent: all six, CLI default first and initial.
  L.setTarget(null);
  L.newAgent(CLAUDE);
  await until(() => !accessSel.disabled);
  check(
    opts().join(',') === 'default,ask,edits,auto,full,plan',
    'Claude Code offers every level: ' + opts().join(',')
  );
  check(
    P.access() === 'default' && pill() === 'Access',
    'CLI default is the initial level: ' + JSON.stringify(pill())
  );
  check(
    /runs commands without asking/.test(
      accessSel.querySelector('option[value="full"]').textContent
    ),
    'Full access says what it means in the menu'
  );

  // Codex has no edits-only mode: greyed out with the registry's reason, never swapped for a nearby
  // level.
  L.newAgent('Codex');
  await wait(150);
  const edits = accessSel.querySelector('option[value="edits"]');
  check(
    edits.disabled && /Codex has no edits-only mode/.test(edits.title),
    'Codex: Allow edits greyed out with the reason: ' + JSON.stringify(edits.title)
  );
  L.newAgent('OpenCode');
  await wait(150);
  const ocAuto = accessSel.querySelector('option[value="auto"]');
  check(
    opts().join(',') === 'default,ask,edits,auto:off,full,plan' &&
      /OpenCode has no automatic review/.test(ocAuto.title),
    'OpenCode offers every level but Auto review (greyed out with the reason): ' +
      opts().join(',') +
      ' ' +
      JSON.stringify(ocAuto.title)
  );

  // A new Claude Code agent picked at Plan only starts with --permission-mode plan; the pick is
  // kept for this project.
  L.newAgent(CLAUDE);
  await wait(150);
  await pick('plan');
  check(
    pill() === 'Plan only' && P.access() === 'plan',
    'the pill shows Plan only: ' + JSON.stringify(pill())
  );
  check(
    JSON.parse(localStorage.getItem('tnai.access.v1') || '{}')[root] === 'plan',
    'kept for this project folder'
  );
  L.newAgent(false);
  let opened = await window.TnaiTest.open(CLAUDE, { accountId: '' });
  if (!check(!!opened?.ok, 'a new Claude Code panel opened')) throw new Error('no new panel');
  panes.push(opened.paneId);
  let started = await until(
    async () =>
      (/FAKE-claude permission=\S+ resume=\S+ \./.exec(await screen(opened.paneId)) || [])[0],
    20000
  );
  check(
    /permission=plan /.test(started || ''),
    'started with --permission-mode plan: ' + JSON.stringify(started)
  );
  check(P.paneAccess(opened.paneId) === 'plan', 'the panel remembers the level it started with');

  // On that running agent the pill says when a change takes effect; the pick changes the project's
  // level, not the running agent.
  L.setTarget(opened.paneId);
  await wait(200);
  check(
    /started with Plan only.*takes effect when it next starts a new conversation/.test(
      accessSel.nextElementSibling.title
    ),
    'on a running agent: ' + JSON.stringify(accessSel.nextElementSibling.title)
  );

  // A sub-agent never gets more access than its lead: the lead started at Plan only, the project is
  // now Full access.
  L.setTarget(null);
  L.newAgent(CLAUDE);
  await wait(150);
  await pick('full');
  check(
    P.subAccess(opened.paneId, CLAUDE) === 'plan',
    'a Claude Code sub-agent of a Plan only lead starts at Plan only, not Full access'
  );
  check(
    P.subAccess(opened.paneId, 'Codex') === 'plan',
    'a Codex sub-agent of that lead: Plan only'
  );
  check(
    P.subAccess(opened.paneId, 'OpenCode') === 'plan',
    'an OpenCode sub-agent of that lead: Plan only (its plan agent)'
  );

  // A resumed OpenCode panel gets its level again (its rules are launch config, not part of the
  // conversation); the other CLIs keep their own.
  const ocA = P.start('tnai-test-oc-resume-a', 'OpenCode', true),
    clA = P.start('tnai-test-claude-resume', CLAUDE, true);
  check(
    ocA?.access === 'full' && clA === null,
    'resumed at project level Full access: OpenCode is sent full, Claude Code nothing: ' +
      JSON.stringify([ocA, clA])
  );
  await pick('ask');
  const ocA2 = P.start('tnai-test-oc-resume-a', 'OpenCode', true),
    ocB = P.start('tnai-test-oc-resume-b', 'OpenCode', true);
  check(
    ocA2?.access === 'full' && ocB?.access === 'ask',
    'a restart in this run keeps the level the panel started with (full); a panel not seen in this run gets the project level (ask): ' +
      JSON.stringify([ocA2, ocB])
  );
  check(
    P.subAccess(opened.paneId, CLAUDE) === 'plan',
    'a lower project level still never lifts it above the lead'
  );

  // CLI default adds nothing to the command line.
  await pick('default');
  L.newAgent(false);
  opened = await window.TnaiTest.open(CLAUDE, { accountId: '' });
  if (check(!!opened?.ok, 'a second Claude Code panel opened')) {
    panes.push(opened.paneId);
    started = await until(
      async () =>
        (/FAKE-claude permission=\S+ resume=\S+ \./.exec(await screen(opened.paneId)) || [])[0],
      20000
    );
    check(
      /permission=none /.test(started || ''),
      'at CLI default no --permission-mode is passed: ' + JSON.stringify(started)
    );
  }

  // Settings › Agents › While agents work: the default for projects without their own pick.
  const def = document.querySelector('#agentsWorkCard .tnai-access-row select');
  if (check(!!def, 'Settings has the Access for new agents row')) {
    def.value = 'ask';
    def.dispatchEvent(new Event('change'));
    await wait(100);
    check(
      P.access() === 'default',
      'this project keeps its own pick (CLI default) after the Settings default changes'
    );
    window.dispatchEvent(
      new CustomEvent('tnai:project-changed', { detail: { root: root + '-other', previous: root } })
    );
    await wait(150);
    check(
      P.access() === 'ask',
      'a project with no pick of its own uses the Settings default (Ask first)'
    );
    window.dispatchEvent(
      new CustomEvent('tnai:project-changed', { detail: { root, previous: root + '-other' } })
    );
    await wait(150);
    check(P.access() === 'default', 'back in the first project its own pick is used again');
  }
  L.newAgent(false);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
for (const id of panes) {
  G.stop(id);
  await wait(400);
}
KEYS.forEach((k, i) => {
  if (saved[i] === null) localStorage.removeItem(k);
  else localStorage.setItem(k, saved[i]);
});
return { ok, log };
