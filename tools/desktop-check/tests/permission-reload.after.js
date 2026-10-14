/*
 * Technically Not tools · desktop-check/tests/permission-reload.after.js — After the reload
 * (permission-reload.js): both still-open prompts are on the card and each answer reaches its held
 * hook request; nothing is decided without a click.
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
    await wait(40);
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
const card = () => document.querySelector('.tnai-perm');
const decision = reply => {
  try {
    return JSON.parse(reply).hookSpecificOutput?.decision?.behavior || 'none';
  } catch {
    return reply;
  }
};
const answer = async (text, d) => {
  const shown = await until(
    () =>
      card() &&
      !card().hidden &&
      card().querySelector('.tnai-perm-detail').textContent.includes(text)
  );
  check(
    !!shown,
    'reloaded page shows the open prompt "' +
      text +
      '" (' +
      (card()?.querySelector('.tnai-perm-count').textContent || 'no count') +
      ')'
  );
  if (shown) {
    // Since 0.3.68 (src/scripts/45-agent-permissions.js, SWAP_MS) the card's
    // buttons take no click for 600 ms after another prompt took a card that was already showing,
    // so a click meant for the prompt before cannot answer the next one. This test was written
    // before that and pressed at once: its second press fell into that time and answered nothing.
    // It now presses as a person can: when the button takes a click again.
    const b = card().querySelector('[data-d="' + d + '"]'),
      held = b.disabled;
    if (held) {
      const free = await until(() => !b.disabled, 2000);
      check(
        !!free,
        'the card held its buttons for a moment after "' +
          text +
          '" took the place of the prompt before, then gave them back'
      );
    }
    b.click();
  }
  return !!shown;
};
try {
  await until(async () => (await main('pending')).length === 2, 3000);
  const pending = await main('pending');
  check(
    pending.length === 2,
    'both prompts still open in main after the reload: ' + JSON.stringify(pending)
  );
  check(
    (await main('reply', 'before', 300)) === 'still waiting' &&
      (await main('reply', 'during', 300)) === 'still waiting',
    'neither was decided by the reload'
  );
  if (await answer('before-reload', 'deny'))
    check(
      decision(await main('reply', 'before', 3000)) === 'deny',
      'Deny on the reloaded page denies the prompt asked before the reload'
    );
  if (await answer('during-reload', 'once'))
    check(
      decision(await main('reply', 'during', 3000)) === 'allow',
      'Allow once on the reloaded page allows the prompt asked during the reload'
    );
  check(await until(() => card().hidden, 2000), 'card put away once both are answered');
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
